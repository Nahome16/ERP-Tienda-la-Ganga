import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { ApiError } from '../lib/api'
import type { ProductImage } from '../lib/apiTypes'
import { getProduct } from './adminApi'
import { deleteImage, processImageFile, reorderImages, uploadErrorMessage, type UploadStage } from './imageApi'
import { ACCEPT_ATTRIBUTE, MAX_IMAGES, makeFirst, moveItem, remainingSlots, selectFiles, withOrder } from './imageUtils'
import { messageFrom } from './format'
import { Notice } from './ui'
import { Plus } from 'lucide-react'

/** Marcador neutro cuando no hay imagen (o no cargó). */
export function ImagePlaceholder({ label = 'Sin imagen' }: { label?: string }) {
  return (
    <span className="img-placeholder" role="img" aria-label={label}>
      <svg viewBox="0 0 24 24" width="55%" height="55%" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="9" cy="10" r="1.7" />
        <path d="m4 18 5-5 3.5 3.5L16 13l4 4" />
      </svg>
    </span>
  )
}

/** Miniatura de tamaño fijo con respaldo si la imagen no carga. */
export function Thumb({ src, name, size = 40 }: { src: string | null | undefined; name: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  const broken = failed === src
  return (
    <span className="img-thumb" style={{ width: size, height: size }}>
      {src && !broken
        ? <img src={src} alt={`Foto de ${name}`} width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(src)} />
        : <ImagePlaceholder />}
    </span>
  )
}

type Stage = UploadStage | 'error'
type UploadItem = { key: string; file: File; preview: string; stage: Stage; progress: number; error: string | null }

let counter = 0
const nextKey = () => `up-${Date.now()}-${counter++}`

function pickFiles(list: FileList | null): File[] {
  return list ? Array.from(list) : []
}

type ManagerProps = {
  productId: string
  images: ProductImage[]
  canManage: boolean
  /** Se avisa cuando la galería cambia (para refrescar listas con la miniatura principal). */
  onChanged?: () => void
}

/** Galería del producto: subir, reordenar, marcar principal y eliminar (hasta 4 imágenes). */
export function ImageManager({ productId, images: initial, canManage, onChanged }: ManagerProps) {
  const [images, setImages] = useState<ProductImage[]>(() => [...initial].sort((a, b) => a.sortOrder - b.sortOrder))
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [notices, setNotices] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const pickRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadsRef = useRef<UploadItem[]>([])
  const changedRef = useRef(onChanged)
  useEffect(() => { changedRef.current = onChanged })
  useEffect(() => { uploadsRef.current = uploads }, [uploads])
  useEffect(() => () => { uploadsRef.current.forEach((item) => URL.revokeObjectURL(item.preview)) }, [])

  const active = uploads.filter((item) => item.stage !== 'error').length
  const slots = remainingSlots(images.length + active)
  const full = slots === 0

  const say = (tone: 'ok' | 'error' | 'warn', text: string) => setNotices([{ tone, text }])

  const refreshFromServer = useCallback(async () => {
    try {
      const fresh = await getProduct(productId)
      setImages([...fresh.images].sort((a, b) => a.sortOrder - b.sortOrder))
    } catch { /* se conserva lo que ya se ve */ }
  }, [productId])

  const patchUpload = (key: string, patch: Partial<UploadItem>) =>
    setUploads((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  const dropUpload = (key: string) =>
    setUploads((list) => {
      list.filter((item) => item.key === key).forEach((item) => URL.revokeObjectURL(item.preview))
      return list.filter((item) => item.key !== key)
    })

  async function runUpload(item: UploadItem) {
    patchUpload(item.key, { stage: 'preparing', progress: 0, error: null })
    try {
      const image = await processImageFile(productId, item.file, (stage, progress) => patchUpload(item.key, { stage, progress }))
      setImages((list) => [...list, image].sort((a, b) => a.sortOrder - b.sortOrder))
      dropUpload(item.key)
      changedRef.current?.()
    } catch (caught) {
      patchUpload(item.key, { stage: 'error', error: uploadErrorMessage(caught) })
      if (caught instanceof ApiError && (caught.status === 409 || caught.code === 'image_limit')) void refreshFromServer()
    }
  }

  function addFiles(files: File[]) {
    if (!canManage || files.length === 0) return
    const { accepted, rejected } = selectFiles(files, slots)
    const items: UploadItem[] = accepted.map((file) => ({
      key: nextKey(), file, preview: URL.createObjectURL(file), stage: 'preparing', progress: 0, error: null,
    }))
    setNotices(rejected.map((text) => ({ tone: 'warn' as const, text })))
    if (items.length === 0) return
    setUploads((list) => [...list, ...items])
    // En fila: así el servidor nunca recibe más de 4 a la vez y el orden queda como se eligió.
    void (async () => { for (const item of items) await runUpload(item) })()
  }

  function retry(item: UploadItem) {
    if (slots === 0) { say('warn', 'Ya hay 4 imágenes: eliminá alguna antes de reintentar.'); return }
    setNotices([])
    void runUpload(item)
  }

  async function persistOrder(next: ProductImage[], okText: string) {
    const previous = images
    setImages(next)
    setBusy(true)
    setNotices([])
    try {
      const saved = await reorderImages(productId, next.map((image) => image.id))
      setImages([...saved].sort((a, b) => a.sortOrder - b.sortOrder))
      say('ok', okText)
      onChanged?.()
    } catch (caught) {
      setImages(previous)
      say('error', messageFrom(caught))
    } finally {
      setBusy(false)
    }
  }

  const move = (index: number, to: number) => {
    if (to < 0 || to >= images.length) return
    void persistOrder(withOrder(moveItem(images, index, to)), to === 0 ? 'La imagen quedó como principal.' : 'Se guardó el nuevo orden.')
  }

  const makePrimary = (id: string) => void persistOrder(withOrder(makeFirst(images, id)), 'La imagen quedó como principal.')

  async function remove(image: ProductImage) {
    setBusy(true)
    setNotices([])
    setConfirmId(null)
    try {
      await deleteImage(productId, image.id)
      setImages((list) => withOrder(list.filter((item) => item.id !== image.id)))
      say('ok', 'Se eliminó la imagen.')
      onChanged?.()
      void refreshFromServer()
    } catch (caught) {
      say('error', messageFrom(caught))
      if (caught instanceof ApiError && caught.status === 404) void refreshFromServer()
    } finally {
      setBusy(false)
    }
  }

  function onDropFiles(event: DragEvent) {
    event.preventDefault()
    setDropActive(false)
    if (!canManage || dragId) return
    addFiles(Array.from(event.dataTransfer.files))
  }

  function onDropOnTile(event: DragEvent, targetIndex: number) {
    if (!dragId) return
    event.preventDefault()
    event.stopPropagation()
    const from = images.findIndex((image) => image.id === dragId)
    setDragId(null)
    if (from >= 0 && from !== targetIndex) move(from, targetIndex)
  }

  const hasTiles = images.length > 0 || uploads.length > 0

  return (
    <section className="img-manager" aria-label="Imágenes del producto">
      <div className="img-head">
        <h3>Imágenes <small>{images.length} de {MAX_IMAGES}</small></h3>
        {canManage && (
          <div className="adm-actions">
            <button type="button" className="secondary-button" disabled={full || busy} onClick={() => pickRef.current?.click()}>Subir fotos</button>
            <button type="button" className="secondary-button" disabled={full || busy} onClick={() => cameraRef.current?.click()}>Tomar foto</button>
          </div>
        )}
      </div>

      {canManage && (
        <>
          <input ref={pickRef} type="file" hidden multiple accept={ACCEPT_ATTRIBUTE} data-testid="image-input"
            onChange={(event) => { addFiles(pickFiles(event.target.files)); event.target.value = '' }} />
          <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment" data-testid="image-camera"
            onChange={(event) => { addFiles(pickFiles(event.target.files)); event.target.value = '' }} />
        </>
      )}

      {full && canManage && <Notice tone="info">Ya hay {MAX_IMAGES} imágenes, que es el máximo. Eliminá una para subir otra.</Notice>}
      {notices.map((notice, index) => <Notice key={`${index}-${notice.text}`} tone={notice.tone}>{notice.text}</Notice>)}

      <div
        className={`img-grid${dropActive ? ' is-drop' : ''}`}
        onDragOver={(event) => { if (canManage && !dragId && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropActive(true) } }}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDropFiles}
        data-testid="image-dropzone"
      >
        {images.map((image, index) => (
          <figure
            key={image.id} className={`img-tile${image.isPrimary ? ' is-primary' : ''}${dragId === image.id ? ' is-dragging' : ''}`}
            data-testid="image-tile"
            draggable={canManage && !busy}
            onDragStart={(event) => { setDragId(image.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', image.id) }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(event) => { if (dragId) event.preventDefault() }}
            onDrop={(event) => onDropOnTile(event, index)}
          >
            <a href={image.url} target="_blank" rel="noreferrer" className="img-frame" aria-label={`Ver imagen ${index + 1} en tamaño completo`}>
              <Thumb src={image.thumbUrl} name={`imagen ${index + 1}`} size={160} />
            </a>
            {image.isPrimary && <span className="img-badge">Principal</span>}
            {canManage && confirmId !== image.id && (
              <figcaption className="img-actions">
                <button type="button" aria-label="Mover a la izquierda" disabled={busy || index === 0} onClick={() => move(index, index - 1)}>◀</button>
                <button type="button" aria-label="Mover a la derecha" disabled={busy || index === images.length - 1} onClick={() => move(index, index + 1)}>▶</button>
                {!image.isPrimary && <button type="button" className="wide" disabled={busy} onClick={() => makePrimary(image.id)}>Hacer principal</button>}
                <button type="button" className="danger" disabled={busy} onClick={() => setConfirmId(image.id)}>Eliminar</button>
              </figcaption>
            )}
            {canManage && confirmId === image.id && (
              <figcaption className="img-confirm" role="alertdialog" aria-label="Confirmar eliminación">
                <p>¿Eliminar esta imagen?{image.isPrimary && images.length > 1 ? ' La siguiente pasará a ser la principal.' : ''}</p>
                <div>
                  <button type="button" className="danger" disabled={busy} onClick={() => { void remove(image) }}>Sí, eliminar</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmId(null)}>Cancelar</button>
                </div>
              </figcaption>
            )}
          </figure>
        ))}

        {uploads.map((item) => (
          <figure key={item.key} className={`img-tile is-upload${item.stage === 'error' ? ' has-error' : ''}`} data-testid="image-upload">
            <span className="img-frame"><img src={item.preview} alt={`Vista previa de ${item.file.name}`} /></span>
            {item.stage !== 'error' ? (
              <figcaption className="img-progress" role="status">
                <span>{item.stage === 'preparing' ? 'Preparando…' : `Subiendo ${Math.round(item.progress * 100)}%`}</span>
                <progress max={1} value={item.stage === 'preparing' ? undefined : item.progress} aria-label={`Subiendo ${item.file.name}`} />
              </figcaption>
            ) : (
              <figcaption className="img-confirm" role="alert">
                <p>{item.error}</p>
                <div>
                  <button type="button" onClick={() => retry(item)}>Reintentar</button>
                  <button type="button" onClick={() => dropUpload(item.key)}>Descartar</button>
                </div>
              </figcaption>
            )}
          </figure>
        ))}

        {canManage && !full && (
          <button type="button" className="img-add" disabled={busy} onClick={() => pickRef.current?.click()}>
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
            <b>Agregar fotos</b>
            <small>o arrastralas acá · quedan {slots}</small>
          </button>
        )}
        {!hasTiles && !canManage && <p className="adm-muted img-empty">Este producto todavía no tiene imágenes.</p>}
      </div>
      {canManage && <p className="adm-muted img-hint">JPEG, PNG o WebP de hasta 15 MB. La foto se reduce antes de subirla. La primera imagen es la principal: se ve en el punto de venta.</p>}
    </section>
  )
}

/** Selector de imágenes para el alta de producto: se suben después de crearlo. */
export function PendingImages({ onChange }: { onChange: (files: File[]) => void }) {
  const [items, setItems] = useState<{ file: File; url: string }[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const pickRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => () => { itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url)) }, [])

  function commit(next: { file: File; url: string }[]) {
    setItems(next)
    onChange(next.map((item) => item.file))
  }

  function add(list: File[]) {
    const { accepted, rejected } = selectFiles(list, remainingSlots(items.length))
    setProblems(rejected)
    if (accepted.length > 0) commit([...items, ...accepted.map((file) => ({ file, url: URL.createObjectURL(file) }))])
  }

  function remove(item: { file: File; url: string }) {
    URL.revokeObjectURL(item.url)
    commit(items.filter((other) => other !== item))
  }

  return (
    <section className="img-manager" aria-label="Imágenes del producto">
      <div className="img-head">
        <h3>Imágenes <small>opcional · {items.length} de {MAX_IMAGES}</small></h3>
        <div className="adm-actions">
          <button type="button" className="secondary-button" disabled={items.length >= MAX_IMAGES} onClick={() => pickRef.current?.click()}>Elegir fotos</button>
          <button type="button" className="secondary-button" disabled={items.length >= MAX_IMAGES} onClick={() => cameraRef.current?.click()}>Tomar foto</button>
        </div>
      </div>
      <input ref={pickRef} type="file" hidden multiple accept={ACCEPT_ATTRIBUTE} data-testid="create-image-input"
        onChange={(event) => { add(pickFiles(event.target.files)); event.target.value = '' }} />
      <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment"
        onChange={(event) => { add(pickFiles(event.target.files)); event.target.value = '' }} />
      {problems.map((text) => <Notice key={text} tone="warn">{text}</Notice>)}
      <div
        className="img-grid compact"
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
        onDrop={(event) => { event.preventDefault(); add(Array.from(event.dataTransfer.files)) }}
      >
        {items.map((item, index) => (
          <figure key={item.url} className={`img-tile${index === 0 ? ' is-primary' : ''}`} data-testid="pending-image">
            <span className="img-frame"><img src={item.url} alt={`Vista previa de ${item.file.name}`} /></span>
            {index === 0 && <span className="img-badge">Principal</span>}
            <figcaption className="img-actions">
              <button type="button" className="danger" onClick={() => remove(item)}>Quitar</button>
            </figcaption>
          </figure>
        ))}
        {items.length < MAX_IMAGES && (
          <button type="button" className="img-add" onClick={() => pickRef.current?.click()}>
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" /><b>Agregar fotos</b><small>o arrastralas acá</small>
          </button>
        )}
      </div>
      <p className="adm-muted img-hint">Se suben justo después de crear el producto. La primera será la principal.</p>
    </section>
  )
}
