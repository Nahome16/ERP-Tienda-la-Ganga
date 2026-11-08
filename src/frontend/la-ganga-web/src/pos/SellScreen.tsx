import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { hasPermission } from '../lib/access'
import type { CashSession, DiscountType, PosVariant, Sale, SaleChannel, SaleRequestPayment } from '../lib/apiTypes'
import { computeTotals, discountExceedsLimit, formatNio } from '../lib/money'
import type { CurrentUser } from '../types'
import { ApprovalModal } from './ApprovalModal'
import { addToCart, cartQuantity, cartUnits, removeLine, setLineQuantity } from './cart'
import type { PosEngine, EngineState } from './engine'
import { signal } from './feedback'
import { channelLabel, channels } from './format'
import { useNow } from './hooks'
import { Modal } from './Modal'
import { PaymentModal } from './PaymentModal'
import { parseAmount } from './payments'
import { buildSaleRequest, buildLocalSale, newClientSaleId } from './sale'
import { PosThumb } from './Thumb'
import { buildIndex, findByBarcode, groupByProduct, searchVariants } from './search'
import { availableStock, pendingUnits } from './stock'
import { clearCartDraft, loadCartDraft, saveCartDraft } from './storage'
import type { CartLine, DiscountApproval } from './types'

type SellScreenProps = {
  user: CurrentUser
  session: CashSession
  engine: PosEngine
  engineState: EngineState
  soundEnabled: boolean
  onPrint: (sale: Sale) => void
  notify: (message: string, tone?: 'ok' | 'warn' | 'error') => void
}

type ModalState =
  | { kind: 'pay' }
  | { kind: 'approval' }
  | { kind: 'done'; clientSaleId: string }
  | null

type ScanFeedback = { tone: 'ok' | 'error' | 'info'; text: string }

const MAX_PRODUCTS = 60

function variantLabel(variant: Pick<PosVariant, 'productName' | 'colorName' | 'sizeName'> | CartLine): string {
  return `${variant.productName} · ${variant.colorName} · ${variant.sizeName}`
}

export function SellScreen({ user, session, engine, engineState, soundEnabled, onPrint, notify }: SellScreenProps) {
  const snapshot = engineState.snapshot?.snapshot ?? null
  const settings = snapshot?.settings
  const scannerRef = useRef<HTMLInputElement>(null)
  const now = useNow(15_000)

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [category, setCategory] = useState<string | null>(null)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ScanFeedback>({ tone: 'info', text: 'Escaneá un código o buscá por nombre, talla o color.' })

  const [lines, setLines] = useState<CartLine[]>([])
  const [channel, setChannel] = useState<SaleChannel>('Store')
  const [discountType, setDiscountType] = useState<DiscountType>('Percent')
  const [discountText, setDiscountText] = useState('')
  const [approval, setApproval] = useState<DiscountApproval | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [payBusy, setPayBusy] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [draftLoaded, setDraftLoaded] = useState(false)

  const index = useMemo(() => buildIndex(snapshot?.variants ?? []), [snapshot])
  const pending = useMemo(() => pendingUnits(engineState.outbox, snapshot), [engineState.outbox, snapshot])
  const unlimitedDiscount = hasPermission(user, 'sale.discount.unlimited')
  const offline = engineState.connection === 'offline'

  const focusScanner = useCallback((select = false) => {
    const input = scannerRef.current
    if (!input) return
    input.focus()
    if (select) input.select()
  }, [])

  // --- Borrador del carrito: se recupera al abrir y se guarda al cambiar ---
  useEffect(() => {
    let cancelled = false
    loadCartDraft(user.id).then((draft) => {
      if (cancelled) return
      if (draft && draft.lines.length > 0) {
        setLines(draft.lines)
        setChannel(draft.channel)
        if (draft.discount) {
          setDiscountType(draft.discount.type)
          setDiscountText(String(draft.discount.value))
        }
        notify('Recuperamos la venta que estaba en curso.', 'ok')
      }
    }).catch(() => undefined).finally(() => { if (!cancelled) setDraftLoaded(true) })
    return () => { cancelled = true }
  }, [user.id, notify])

  const discountValue = parseAmount(discountText)
  const discount = useMemo(
    () => (discountValue > 0 ? { type: discountType, value: discountValue } : null),
    [discountType, discountValue],
  )

  useEffect(() => {
    if (!draftLoaded) return
    const timer = setTimeout(() => {
      if (lines.length === 0) void clearCartDraft().catch(() => undefined)
      else void saveCartDraft({ key: 'cartDraft', userId: user.id, lines, channel, discount, note: '' }).catch(() => undefined)
    }, 400)
    return () => clearTimeout(timer)
  }, [draftLoaded, lines, channel, discount, user.id])

  // --- Totales y descuento ---
  const totals = useMemo(() => computeTotals({ lines, discount }), [lines, discount])
  const needsApproval = settings ? !unlimitedDiscount && discountExceedsLimit(totals, settings) : false
  const approvalValid = Boolean(
    approval && approval.type === discountType && approval.value === discountValue && Date.parse(approval.expiresAtUtc) > now,
  )
  const discountBlocked = needsApproval && !approvalValid
  const units = cartUnits(lines)

  // --- Búsqueda local ---
  const results = useMemo(() => {
    const variants = searchVariants(index, deferredQuery, category)
    return groupByProduct(variants)
  }, [index, deferredQuery, category])
  const shownProducts = results.slice(0, MAX_PRODUCTS)
  const activeProduct = results.find((group) => group.productId === selectedProductId) ?? (results.length === 1 ? results[0] : undefined)

  const remaining = useCallback(
    (variant: PosVariant) => availableStock(variant.stock, variant.variantId, pending) - cartQuantity(lines, variant.variantId),
    [pending, lines],
  )

  function announce(tone: ScanFeedback['tone'], text: string) {
    setFeedback({ tone, text })
    if (tone === 'ok') signal('ok', soundEnabled)
    if (tone === 'error') signal('error', soundEnabled)
  }

  /**
   * Cambia la cantidad de una variante. Nunca se puede vender más de lo que hay en el sistema:
   * si se pide más, la cantidad no cambia y se avisa cuántas unidades quedan.
   */
  function requestQuantity(variantId: string, quantity: number, label: string) {
    const known = index.byId.get(variantId)
    const current = cartQuantity(lines, variantId)
    if (known && quantity > current) {
      const available = availableStock(known.stock, variantId, pending)
      if (quantity > available) {
        announce('error', available <= 0 ? `Sin existencias de ${label}.` : `Solo quedan ${available} ${available === 1 ? 'unidad' : 'unidades'} de ${label}.`)
        return false
      }
    }
    setLines((currentLines) => setLineQuantity(currentLines, variantId, quantity))
    return true
  }

  function addVariant(variant: PosVariant) {
    const current = cartQuantity(lines, variant.variantId)
    if (current === 0) {
      const available = availableStock(variant.stock, variant.variantId, pending)
      if (available < 1) {
        announce('error', `Sin existencias de ${variantLabel(variant)}: no se puede vender.`)
        return
      }
      setLines((currentLines) => addToCart(currentLines, variant))
    } else if (!requestQuantity(variant.variantId, current + 1, variantLabel(variant))) {
      return
    }
    announce('ok', `Agregado: ${variantLabel(variant)}`)
  }

  function submitScan(event: FormEvent) {
    event.preventDefault()
    const code = query.trim()
    if (!code) {
      if (lines.length > 0) openPayment()
      return
    }
    const exact = findByBarcode(index, code)
    if (exact) {
      addVariant(exact)
      setQuery('')
      return
    }
    const matches = searchVariants(index, code, category)
    if (matches.length === 0) {
      const looksLikeCode = !/\s/.test(code) && code.length >= 6
      announce('error', looksLikeCode ? `Código no encontrado: ${code}. No se creó ningún producto.` : `Sin resultados para «${code}».`)
      setQuery('')
    } else if (matches.length === 1 && matches[0]) {
      addVariant(matches[0])
      setQuery('')
    } else {
      announce('info', `${groupByProduct(matches).length} producto(s) coinciden. Elegí la talla y el color.`)
    }
  }

  // --- Cobro ---
  function openPayment() {
    if (lines.length === 0 || !settings) return
    const short = lines.find((line) => {
      const known = index.byId.get(line.variantId)
      return known !== undefined && line.quantity > availableStock(known.stock, line.variantId, pending)
    })
    if (short) {
      // El inventario cambió después de agregar la prenda (otra caja la vendió): hay que corregir antes de cobrar.
      const left = Math.max(0, availableStock(index.byId.get(short.variantId)?.stock ?? 0, short.variantId, pending))
      announce('error', `Ya no hay suficiente stock de ${variantLabel(short)}: quedan ${left}. Ajustá la cantidad o quitá la prenda.`)
      return
    }
    if (discountBlocked) {
      if (offline) announce('error', `Sin conexión: un descuento mayor a ${settings.sellerDiscountLimitPercent}% necesita aprobación del administrador. Bajalo o esperá la conexión.`)
      else setModal({ kind: 'approval' })
      return
    }
    setPayError(null)
    setModal({ kind: 'pay' })
  }

  async function confirmPayment(payments: SaleRequestPayment[]) {
    if (!settings || payBusy) return
    setPayBusy(true)
    setPayError(null)
    try {
      const clientSaleId = newClientSaleId()
      const request = buildSaleRequest({
        clientSaleId,
        cashSessionId: session.id,
        channel,
        createdAtUtc: new Date().toISOString(),
        isOffline: engineState.connection === 'offline',
        lines,
        discount,
        discountApprovalId: needsApproval && approvalValid && approval ? approval.approvalId : null,
        payments,
        note: null,
      })
      const localSale = buildLocalSale(request, lines, { session, sellerName: user.displayName, settings })
      // Primero a la cola local (IndexedDB); el envío al servidor ocurre en segundo plano.
      await engine.enqueue({ clientSaleId, userId: user.id, userName: user.displayName, request, localSale })
      // El borrador se borra ya (no a los 400 ms): si se recarga justo ahora, la venta cobrada no debe reaparecer.
      void clearCartDraft().catch(() => undefined)
      setLines([])
      setDiscountText('')
      setApproval(null)
      setChannel('Store')
      setQuery('')
      setSelectedProductId(null)
      setModal({ kind: 'done', clientSaleId })
      signal('ok', soundEnabled)
    } catch (error) {
      console.error('No se pudo guardar la venta', error)
      setPayError('No se pudo guardar la venta en este equipo. No se cobró nada en el sistema: intentá de nuevo.')
    } finally {
      setPayBusy(false)
    }
  }

  function closeModal() {
    setModal(null)
    setTimeout(() => focusScanner(), 0)
  }

  // --- Atajos de teclado globales ---
  const stateRef = useRef({ openPayment, hasCart: false })
  useEffect(() => {
    stateRef.current = { openPayment, hasCart: lines.length > 0 }
  })
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'F2') {
        event.preventDefault()
        if (!document.querySelector('.pv-overlay')) focusScanner(true)
        return
      }
      if (document.querySelector('.pv-overlay')) return
      const target = event.target instanceof HTMLElement ? event.target : null
      const onBody = !target || target === document.body
      if (event.key === 'Enter' && onBody && stateRef.current.hasCart) {
        event.preventDefault()
        stateRef.current.openPayment()
      } else if (onBody && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Un lector de códigos escribiendo sin foco: lo llevamos al campo de escaneo.
        focusScanner()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusScanner])

  useEffect(() => {
    const timer = setTimeout(() => focusScanner(), 50)
    return () => clearTimeout(timer)
  }, [focusScanner])

  const doneEntry = modal?.kind === 'done' ? engineState.outbox.find((entry) => entry.clientSaleId === modal.clientSaleId) ?? null : null

  if (!snapshot || !settings) return null

  const discountPercentLabel = discount ? `${totals.discountPercent}%` : ''

  return (
    <div className="pv-sell">
      <section className="pv-catalog" aria-label="Catálogo">
        <form className="pv-scanner" onSubmit={submitScan}>
          <label htmlFor="pv-scan-input" className="pv-sr-only">Escanear código de barras o buscar producto</label>
          <span className="pv-scanner-icon" aria-hidden="true">▥</span>
          <input
            id="pv-scan-input" ref={scannerRef} value={query} autoComplete="off" autoCapitalize="none" spellCheck={false}
            placeholder="Escaneá el código o buscá (nombre, marca, talla, color)  ·  F2"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSelectedProductId(null) } }}
          />
          <button type="submit" className="pv-btn pv-btn-primary">{query.trim() ? 'Agregar' : 'Cobrar'}</button>
        </form>
        <p className={`pv-feedback pv-feedback-${feedback.tone}`} role="status" aria-live="polite">{feedback.text}</p>

        {index.categories.length > 1 && (
          <div className="pv-pills" role="group" aria-label="Filtrar por categoría">
            <button type="button" className={category === null ? 'is-active' : ''} onClick={() => setCategory(null)}>Todo</button>
            {index.categories.map((name) => (
              <button type="button" key={name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(category === name ? null : name)}>{name}</button>
            ))}
          </div>
        )}

        {activeProduct && (
          <article className="pv-variants" aria-label={`Variantes de ${activeProduct.productName}`}>
            <header>
              <PosThumb src={activeProduct.imageUrl} name={activeProduct.productName} size="row" />
              <div>
                <h2>{activeProduct.productName}</h2>
                <small>{[activeProduct.brandName, activeProduct.categoryName].filter(Boolean).join(' · ')}</small>
              </div>
              <strong>{activeProduct.minPrice === activeProduct.maxPrice ? formatNio(activeProduct.minPrice) : `${formatNio(activeProduct.minPrice)} – ${formatNio(activeProduct.maxPrice)}`}</strong>
              <button type="button" className="pv-icon-button" aria-label="Cerrar variantes" onClick={() => { setSelectedProductId(null); setQuery(''); focusScanner() }}>✕</button>
            </header>
            <div className="pv-variant-rows">
              {[...new Set(activeProduct.variants.map((variant) => variant.colorName))].map((color) => {
                const colorVariants = activeProduct.variants.filter((variant) => variant.colorName === color)
                return (
                  <div className="pv-variant-row" key={color}>
                    <span className="pv-color"><i style={{ background: colorVariants[0]?.colorHex ?? '#d9d2c5' }} />{color}</span>
                    <div className="pv-size-cells">
                      {colorVariants.map((variant) => {
                        const left = remaining(variant)
                        const tone = left <= 0 ? 'out' : left <= settings.lowStockThreshold ? 'low' : 'ok'
                        return (
                          <button
                            type="button" key={variant.variantId} className={`pv-size pv-size-${tone}`}
                            aria-label={`${variantLabel(variant)}, quedan ${left}`}
                            disabled={left <= 0}
                            title={left <= 0 ? 'Sin existencias' : undefined}
                            onClick={() => { addVariant(variant); focusScanner() }}
                          >
                            <span>{variant.sizeName}</span>
                            <b>{left}</b>
                            {variant.price !== activeProduct.minPrice && <small>{formatNio(variant.price)}</small>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="pv-legend"><span className="pv-dot pv-dot-ok" /> Hay <span className="pv-dot pv-dot-low" /> Quedan pocas <span className="pv-dot pv-dot-out" /> Sin existencias (no se puede vender)</p>
          </article>
        )}

        <div className="pv-products" role="list">
          {shownProducts.map((group) => {
            const total = group.variants.reduce((sum, variant) => sum + Math.max(0, remaining(variant)), 0)
            return (
              <button
                type="button" role="listitem" key={group.productId}
                className={`pv-product${activeProduct?.productId === group.productId ? ' is-active' : ''}`}
                onClick={() => { setSelectedProductId(group.productId); focusScanner() }}
              >
                <PosThumb src={group.imageUrl} name={group.productName} size="card" />
                <strong>{group.productName}</strong>
                <span>{[group.brandName, group.categoryName].filter(Boolean).join(' · ')}</span>
                <b>{group.minPrice === group.maxPrice ? formatNio(group.minPrice) : `desde ${formatNio(group.minPrice)}`}</b>
                <small>{group.variants.length} {group.variants.length === 1 ? 'variante' : 'variantes'} · {total} en stock</small>
              </button>
            )
          })}
          {results.length === 0 && <p className="pv-empty">{snapshot.variants.length === 0 ? 'El catálogo está vacío.' : 'Ningún producto coincide con la búsqueda.'}</p>}
        </div>
        {results.length > MAX_PRODUCTS && <p className="pv-note">Mostrando {MAX_PRODUCTS} de {results.length} productos. Escribí más letras para afinar.</p>}
      </section>

      <aside className="pv-cart" aria-label="Venta actual">
        <header className="pv-cart-head">
          <div><span>Venta actual</span><strong>{units} {units === 1 ? 'artículo' : 'artículos'}</strong></div>
          {lines.length > 0 && (
            <button
              type="button" className="pv-link"
              onClick={() => {
                if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); return }
                setLines([]); setDiscountText(''); setApproval(null); setConfirmClear(false); focusScanner()
              }}
            >{confirmClear ? '¿Seguro? Tocá otra vez' : 'Vaciar'}</button>
          )}
        </header>

        <div className="pv-cart-lines">
          {lines.length === 0 && <div className="pv-empty-cart"><strong>Carrito vacío</strong><p>Escaneá un código o elegí una variante.</p></div>}
          {lines.map((line) => {
            const known = index.byId.get(line.variantId)
            const available = known ? availableStock(known.stock, line.variantId, pending) : null
            const over = available !== null && line.quantity > available
            return (
              <article className={`pv-line${over ? ' is-over' : ''}`} key={line.variantId}>
                <PosThumb src={known?.imageUrl} name={line.productName} size="line" />
                <div className="pv-line-info">
                  <strong>{line.productName}</strong>
                  <small>{line.colorName} · {line.sizeName} · {formatNio(line.unitPrice)}</small>
                  {over && <em>Solo quedan {Math.max(0, available)}: ajustá la cantidad antes de cobrar.</em>}
                </div>
                <div className="pv-qty">
                  <button type="button" aria-label={`Quitar una unidad de ${variantLabel(line)}`} onClick={() => { setLines((current) => setLineQuantity(current, line.variantId, line.quantity - 1)); focusScanner() }}>−</button>
                  <input
                    type="number" min={1} inputMode="numeric" aria-label={`Cantidad de ${variantLabel(line)}`} value={line.quantity}
                    onChange={(event) => {
                      const next = Math.floor(Number(event.target.value))
                      if (Number.isFinite(next) && next >= 1) requestQuantity(line.variantId, next, variantLabel(line))
                    }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); focusScanner() } }}
                  />
                  <button type="button" aria-label={`Sumar una unidad de ${variantLabel(line)}`} onClick={() => { requestQuantity(line.variantId, line.quantity + 1, variantLabel(line)); focusScanner() }}>＋</button>
                </div>
                <b className="pv-line-total">{formatNio(Math.round(line.quantity * line.unitPrice * 100) / 100)}</b>
                <button type="button" className="pv-icon-button" aria-label={`Quitar ${variantLabel(line)} del carrito`} onClick={() => { setLines((current) => removeLine(current, line.variantId)); focusScanner() }}>✕</button>
              </article>
            )
          })}
        </div>

        <div className="pv-cart-foot">
          <div className="pv-channel" role="group" aria-label="Canal de venta">
            {channels.map((item) => (
              <button type="button" key={item} className={channel === item ? 'is-active' : ''} onClick={() => setChannel(item)}>{channelLabel[item]}</button>
            ))}
          </div>

          <div className="pv-discount">
            <div className="pv-discount-row">
              <span id="pv-discount-label">Descuento</span>
              <div className="pv-toggle" role="group" aria-labelledby="pv-discount-label">
                <button type="button" className={discountType === 'Percent' ? 'is-active' : ''} onClick={() => setDiscountType('Percent')}>%</button>
                <button type="button" className={discountType === 'Amount' ? 'is-active' : ''} onClick={() => setDiscountType('Amount')}>C$</button>
              </div>
              <input
                inputMode="decimal" aria-label={discountType === 'Percent' ? 'Porcentaje de descuento' : 'Monto de descuento en córdobas'}
                placeholder="0" value={discountText} autoComplete="off"
                onChange={(event) => setDiscountText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); focusScanner() } }}
              />
            </div>
            {needsApproval && approvalValid && approval && <p className="pv-hint pv-ok">Aprobado por {approval.approverName}.</p>}
            {discountBlocked && (
              <p className="pv-hint pv-warn" role="alert">
                {offline
                  ? `Sin conexión: un descuento mayor a ${settings.sellerDiscountLimitPercent}% necesita aprobación del administrador y no se puede pedir ahora.`
                  : `Más de ${settings.sellerDiscountLimitPercent}%: necesita aprobación del administrador. `}
                {!offline && <button type="button" className="pv-link" onClick={() => setModal({ kind: 'approval' })}>Pedir aprobación</button>}
              </p>
            )}
          </div>

          <dl className="pv-totals">
            <div><dt>Subtotal</dt><dd>{formatNio(totals.subtotalNio)}</dd></div>
            <div><dt>Descuento {discountPercentLabel}</dt><dd>{totals.discountNio > 0 ? `−${formatNio(totals.discountNio)}` : '—'}</dd></div>
            <div className="pv-grand"><dt>Total</dt><dd data-testid="cart-total">{formatNio(totals.totalNio)}</dd></div>
          </dl>

          <button type="button" className="pv-btn pv-btn-primary pv-btn-xl pv-charge" disabled={lines.length === 0 || (discountBlocked && offline)} onClick={openPayment}>
            Cobrar {formatNio(totals.totalNio)} <kbd>Enter</kbd>
          </button>
        </div>
      </aside>

      <div className="pv-mobile-bar">
        <span>{units} art. · <strong>{formatNio(totals.totalNio)}</strong></span>
        <button type="button" className="pv-btn pv-btn-primary" disabled={lines.length === 0 || (discountBlocked && offline)} onClick={openPayment}>Cobrar</button>
      </div>

      {modal?.kind === 'pay' && (
        <PaymentModal
          totalNio={totals.totalNio}
          settings={settings}
          busy={payBusy}
          error={payError}
          onConfirm={(payments) => { void confirmPayment(payments) }}
          onCancel={closeModal}
        />
      )}

      {modal?.kind === 'approval' && discount && (
        <ApprovalModal
          discountType={discount.type}
          discountValue={discount.value}
          discountNio={totals.discountNio}
          discountPercent={totals.discountPercent}
          limitPercent={settings.sellerDiscountLimitPercent}
          onApproved={(result) => { setApproval(result); notify(`Descuento aprobado por ${result.approverName}.`, 'ok'); closeModal() }}
          onCancel={closeModal}
        />
      )}

      {modal?.kind === 'done' && (
        <Modal
          title="Venta registrada"
          size="sm"
          onClose={closeModal}
          footer={(
            <>
              <button
                type="button" className="pv-btn pv-btn-ghost"
                onClick={() => { if (doneEntry) onPrint(doneEntry.serverSale ?? doneEntry.localSale) }}
                disabled={!doneEntry}
              >Imprimir recibo</button>
              <button type="button" className="pv-btn pv-btn-primary pv-btn-xl" data-autofocus onClick={closeModal}>Sin recibo · Nueva venta</button>
            </>
          )}
        >
          {doneEntry && (
            <div className="pv-done" data-testid="sale-done">
              <div className="pv-done-check" aria-hidden="true">✓</div>
              <p className="pv-done-ref">{doneEntry.serverSale ? doneEntry.serverSale.number : doneEntry.localSale.number}</p>
              <p className="pv-done-total">{formatNio(doneEntry.localSale.totalNio)}</p>
              {doneEntry.localSale.changeNio > 0 && <p className="pv-done-change">Cambio a entregar: <strong>{formatNio(doneEntry.localSale.changeNio)}</strong></p>}
              <p className={`pv-done-status is-${doneEntry.status}`} role="status">
                {doneEntry.status === 'sent' && (doneEntry.serverSale?.requiresReview ? 'Enviada · queda en revisión de inventario.' : 'Enviada al servidor.')}
                {(doneEntry.status === 'pending' || doneEntry.status === 'sending') && (offline ? 'Guardada en este equipo. Se enviará sola cuando vuelva la conexión.' : 'Guardada en este equipo. Enviando…')}
                {doneEntry.status === 'attention' && `El servidor no la aceptó: ${doneEntry.lastError ?? 'revisala en «Ventas de esta caja».'}`}
              </p>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
