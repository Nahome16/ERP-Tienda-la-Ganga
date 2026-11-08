# Despliegue en un VPS de Hostinger (guía paso a paso)

Esta guía está escrita para una persona **sin experiencia técnica**. Siguiéndola
al pie de la letra, La Ganga ERP quedará funcionando en internet con candado
HTTPS, respaldos automáticos y listo para usarse en las dos cajas.

Todo lo que necesita hacer *usted* (comprar, configurar el dominio, copiar
claves) está marcado como **Acción humana**. Lo demás son comandos que se copian
y se pegan.

> **Si va a abrir la tienda el 10 de noviembre:** haga los pasos 1, 2 y 3 (compra
> del VPS y del dominio, y apuntar el dominio) **hoy mismo**. El dominio puede
> tardar de minutos a varias horas en "propagarse" y no se puede avanzar sin él.

## Índice

1. [Qué necesita antes de empezar](#1-qué-necesita-antes-de-empezar)
2. [Qué comprar en Hostinger](#2-qué-comprar-en-hostinger)
3. [Apuntar el dominio al servidor](#3-apuntar-el-dominio-al-servidor)
4. [Conectarse al servidor por SSH](#4-conectarse-al-servidor-por-ssh)
5. [Preparar el servidor (una sola vez)](#5-preparar-el-servidor-una-sola-vez)
6. [Instalar La Ganga](#6-instalar-la-ganga)
7. [Crear el administrador inicial](#7-crear-el-administrador-inicial)
8. [Primer ingreso y creación de vendedores](#8-primer-ingreso-y-creación-de-vendedores)
9. [Respaldos automáticos](#9-respaldos-automáticos)
10. [Probar una restauración](#10-probar-una-restauración)
11. [Actualizar el sistema](#11-actualizar-el-sistema)
12. [Si algo falla](#12-si-algo-falla)
13. [Qué pasa si se cae internet](#13-qué-pasa-si-se-cae-internet)
14. [Seguridad](#14-seguridad)
15. [Checklist de salida a producción](#15-checklist-de-salida-a-producción)
16. [Recuperarse si el servidor se pierde](#16-recuperarse-si-el-servidor-se-pierde)
17. [Referencia rápida de comandos](#17-referencia-rápida-de-comandos)

---

## Cómo funciona (en 30 segundos)

```
  Celulares / computadoras de la tienda
              |  HTTPS (candado)
              v
   [ web: Caddy ]  --- sirve la aplicación (PWA) y el certificado SSL gratis
              |  /api/*  y  /health
              v
   [ api: ASP.NET ]  --- la lógica del sistema
              |
              v
   [ db: PostgreSQL ] --- los datos (no es accesible desde internet)
```

Los tres programas viven en "contenedores" de Docker dentro de **un solo
servidor** (VPS). Los datos se guardan en el disco del servidor y cada noche se
hace un respaldo.

---

## 1. Qué necesita antes de empezar

- Una tarjeta o método de pago para Hostinger. **Acción humana.**
- Un **dominio** (por ejemplo `sistema.mitienda.com`). Puede comprarlo en
  Hostinger o en cualquier otro proveedor. **Acción humana.**
- Un **correo real** para registrar el certificado (Let's Encrypt avisa ahí si
  hay problemas).
- Una computadora para escribir comandos:
  - **Windows 10/11:** abra *PowerShell* (menú Inicio, escriba "PowerShell").
    Ya trae el programa `ssh`.
  - **Mac / Linux:** abra la aplicación *Terminal*.
- Aproximadamente 1 a 2 horas (sin contar la espera del dominio).
- La dirección del repositorio de Git del proyecto (botón verde **Code** en
  GitHub, pestaña HTTPS o SSH). En esta guía aparece como
  `URL_DEL_REPOSITORIO`.

**Cómo copiar y pegar comandos:** copie el texto de los recuadros grises, péguelo
en la ventana negra (en PowerShell/Terminal suele ser clic derecho o
`Ctrl+Shift+V`) y presione Enter. Si le pide una contraseña, **no se ve nada
mientras escribe**: es normal.

---

## 2. Qué comprar en Hostinger

**Acción humana.**

1. Entre al sitio de Hostinger y elija un **servidor VPS** (no un hosting
   compartido: el hosting compartido no sirve para este sistema).
2. Requisitos mínimos para elegir el plan (compare los planes disponibles en el
   momento de comprar):

   | Recurso | Mínimo | Recomendado |
   |---|---|---|
   | CPU | 2 vCPU | 2 vCPU o más |
   | Memoria RAM | 2 GB | 4 GB |
   | Disco | 40 GB | 80 GB o más |
   | IP | 1 IPv4 pública | 1 IPv4 pública |

3. Al configurar el sistema operativo hay dos caminos válidos:
   - **Ubuntu 22.04 o 24.04 limpio** (recomendado): el script del paso 5 instala
     todo lo demás.
   - **Ubuntu con Docker** (plantilla del panel, si la ofrecen): también sirve.
     El script detecta que Docker ya está y solo hace el resto.
4. Elija el centro de datos más cercano a Nicaragua que el panel ofrezca.
5. Defina la **contraseña de root** del servidor y guárdela en un lugar seguro.
6. Cuando el VPS esté creado, anote su **dirección IP** (cuatro números
   separados por puntos, por ejemplo `203.0.113.10`; la ve en el panel del VPS).
7. Si el panel de Hostinger tiene un **firewall propio** para el VPS, asegúrese
   de que permita los puertos **22, 80 y 443**.

> Ningún comando de esta guía necesita el panel de Hostinger, salvo reiniciar el
> servidor completo si deja de responder.

---

## 3. Apuntar el dominio al servidor

**Acción humana.** En el lugar donde tiene el dominio (en Hostinger: la sección
de **DNS / Zona DNS** del dominio) cree este registro:

| Tipo | Nombre (Host) | Valor (Apunta a) | TTL |
|---|---|---|---|
| **A** | `sistema` (si quiere `sistema.mitienda.com`) o `@` (si quiere `mitienda.com`) | La IP del VPS | 300 o el valor por defecto |

Detalles importantes:

- Si ya existe un registro **A** con ese mismo nombre (por ejemplo uno de
  "página en construcción"), **edítelo o bórrelo**; no debe haber dos.
- Si existe un registro **AAAA** (IPv6) con ese nombre y no sabe para qué es,
  bórrelo: podría enviar a los visitantes a otro lugar.
- **El DNS puede tardar**: normalmente de 5 a 30 minutos, pero puede llegar a
  varias horas (hasta 24 o 48 en casos raros).

**Cómo saber si ya funciona** (desde su computadora):

```
nslookup sistema.mitienda.com
```

(en Mac/Linux también sirve `dig +short sistema.mitienda.com`). Cuando la
respuesta muestre **la IP de su VPS**, el dominio está listo. **No pase al paso
6 hasta que esto funcione**: Let's Encrypt limita los intentos fallidos y
podría bloquearlo temporalmente.

---

## 4. Conectarse al servidor por SSH

SSH es la forma de "entrar" al servidor para escribir comandos.

En PowerShell/Terminal (cambie `IP_DEL_VPS` por la IP que anotó):

```
ssh root@IP_DEL_VPS
```

- La primera vez pregunta si confía en el servidor: escriba `yes` y Enter.
- Escriba la contraseña de root (no se ve al escribir).
- Sabrá que entró cuando el texto termine en `root@...:~#`.

---

## 5. Preparar el servidor (una sola vez)

Estos comandos se ejecutan **como root** (recién conectado en el paso 4).

### 5.1 Descargar el proyecto temporalmente

```
apt-get update && apt-get install -y git
git clone URL_DEL_REPOSITORIO /root/la-ganga-setup
```

> **Repositorio privado.** Si el repositorio es privado, GitHub no acepta su
> contraseña normal. Use una de estas dos opciones (pida ayuda a quien administra
> el repositorio):
> - **Token de acceso personal (HTTPS):** cuando `git clone` pida usuario y
>   contraseña, use su usuario de GitHub y, como contraseña, un *Personal Access
>   Token* con permiso solo de lectura del repositorio.
> - **Llave de despliegue (SSH, la más cómoda a largo plazo):** en el servidor
>   ejecute `ssh-keygen -t ed25519 -C "la-ganga-vps"` (Enter a todo) y luego
>   `cat ~/.ssh/id_ed25519.pub`. Copie ese texto en GitHub, en el repositorio:
>   **Settings > Deploy keys > Add deploy key** (deje sin marcar "Allow write
>   access"). Después use la dirección SSH del repositorio (empieza con
>   `git@github.com:`).
>
> Más abajo (paso 6) hará lo mismo con el usuario `ganga`, que es el que usará
> siempre.

### 5.2 Ejecutar el script de preparación

```
bash /root/la-ganga-setup/infrastructure/deploy/setup-vps.sh
```

El script (tarda unos minutos) hace, con mensajes en español:

1. Actualiza el sistema.
2. Pone la zona horaria de Managua.
3. Instala Docker y `docker compose` (si no estaban).
4. Crea el usuario **`ganga`** (administración diaria, sin ser root). **Le pedirá
   que escriba una contraseña para ese usuario: anótela en un lugar seguro.**
5. Activa el **firewall**: solo quedan abiertos SSH (22), web (80) y HTTPS (443).
6. Instala **fail2ban**, que bloquea a quien intenta adivinar contraseñas.
7. Crea **memoria de intercambio (swap)** si el servidor tiene poca RAM.
8. Activa las **actualizaciones automáticas de seguridad**.

Es seguro ejecutarlo de nuevo si algo se interrumpe. Si al final avisa que el
servidor necesita reiniciarse, ejecute `reboot`, espere un minuto y vuelva a
conectarse como root.

### 5.3 Cambiar a trabajar con el usuario `ganga`

```
exit
ssh ganga@IP_DEL_VPS
```

A partir de aquí use **siempre** el usuario `ganga`, no root.

---

## 6. Instalar La Ganga

Todo este paso se hace como `ganga`.

### 6.1 Descargar el proyecto

```
git clone URL_DEL_REPOSITORIO ~/la-ganga
cd ~/la-ganga/infrastructure/deploy
```

(Si el repositorio es privado, repita aquí la opción de token o de llave de
despliegue del paso 5.1, ahora con el usuario `ganga`.)

### 6.2 Crear la configuración (archivo `.env`)

```
./init-env.sh
```

Le hará estas preguntas:

| Pregunta | Qué responder |
|---|---|
| Dominio | El del paso 3, sin `https://` (ej. `sistema.mitienda.com`) |
| Correo | Un correo real que usted lea |
| Usuario del administrador | Enter para dejar `administrador`, o el que prefiera |
| Nombre completo | Cómo se mostrará (ej. "Administradora La Ganga") |
| Contraseña del administrador | **12 caracteres o más.** Use una frase larga que pueda recordar. No use apóstrofos (`'`) |

El script genera solo una contraseña larga para la base de datos y guarda todo
en el archivo `.env` (solo su usuario puede leerlo). **Nunca comparta ni suba el
archivo `.env`.**

> Alternativa manual: `cp .env.example .env`, luego `nano .env`, complete los
> valores, guarde con `Ctrl+O`, Enter, y salga con `Ctrl+X`. Después
> `chmod 600 .env`.

### 6.3 Encender el sistema

```
docker compose -f compose.prod.yml up -d --build
```

La primera vez descarga y compila todo: **puede tardar de 5 a 20 minutos** (más
en servidores pequeños). No cierre la ventana. Al terminar, verifique:

```
docker compose -f compose.prod.yml ps
```

Deben aparecer `db`, `api` y `web` como **running** y, con el paso de unos
segundos, `(healthy)`. La API crea sola las tablas de la base de datos, los roles
y las dos cajas al arrancar.

Luego abra en su navegador `https://SU_DOMINIO/api/health`: debe mostrar un texto
con estado correcto y el **candado** de HTTPS. Si el certificado todavía no está
(error de privacidad), espere 1 o 2 minutos y recargue; si persiste, vaya a
[Si algo falla](#12-si-algo-falla).

> **Truco opcional** para escribir menos: ejecute una vez
> `echo 'export COMPOSE_FILE=compose.prod.yml' >> ~/.bashrc` y vuelva a entrar.
> Desde la carpeta `infrastructure/deploy` podrá escribir solo
> `docker compose ps`. En esta guía se muestra siempre el comando completo.

---

## 7. Crear el administrador inicial

Aún dentro de `~/la-ganga/infrastructure/deploy`:

```
docker compose -f compose.prod.yml run --rm cli --bootstrap-admin
```

Debe decir que el administrador inicial fue creado (también carga los catálogos
iniciales: marcas, cortes, tallas, colores y categorías). Esto usa las variables
`LA_GANGA_ADMIN_USERNAME`, `LA_GANGA_ADMIN_DISPLAY_NAME` y
`LA_GANGA_ADMIN_PASSWORD` del `.env`. Si dice que se omitió porque *ya existe al
menos un usuario*, el administrador ya estaba creado.

**Inmediatamente después, borre la contraseña del archivo `.env`:**

```
./init-env.sh --quitar-admin
```

(`cli` es un servicio auxiliar que usa la misma imagen que la API. Sirve también
para `--sync-roles` y `--seed-catalogs` si algún día se lo piden.)

---

## 8. Primer ingreso y creación de vendedores

1. En el navegador abra `https://SU_DOMINIO` e ingrese con el usuario y la
   contraseña del administrador.
2. Vaya a **Equipo** en el menú.
3. Cree **una cuenta por persona**: cada vendedor/a con su propio usuario y
   contraseña, con el rol **Vendedor** (solo punto de venta). Para quien
   administra inventario use el rol **Encargado de inventario**.
4. **Nunca comparta cuentas**: cada venta y cada caja queda registrada con el
   nombre de quien la hizo.
5. Entregue a cada persona su usuario y una contraseña inicial por un medio
   privado, y pídale que la cambie o la guarde bien.

> El sistema bloquea temporalmente los intentos de inicio de sesión repetidos
> (por defecto 5 por minuto desde la misma conexión). Si alguien se equivoca
> varias veces seguidas, debe esperar un minuto.

---

## 9. Respaldos automáticos

### 9.1 Programar el respaldo diario

Con el usuario `ganga`, en `~/la-ganga/infrastructure/deploy`:

```
./install-cron.sh
```

Queda programado **todos los días a las 2:00 a. m. (hora de Managua)**. Cada
respaldo es un archivo comprimido con la fecha y la hora, en la carpeta
`~/la-ganga/infrastructure/deploy/backups/`. Se conservan los **14 más
recientes y uno por cada una de las 8 semanas anteriores**; los demás se borran
solos.

Pruébelo ahora mismo sin esperar a la noche:

```
./backup.sh
ls -lh backups
./install-cron.sh --estado
```

Debe verse un archivo nuevo, de tamaño mayor a cero. Cada respaldo se verifica
al crearse (que no esté vacío y que se pueda leer) y se le calcula una suma de
control. Si algo falla, el registro queda en `backups/backup.log`.

### 9.2 Copia FUERA del servidor (muy recomendado)

Un respaldo guardado **solo en el mismo servidor** no sirve si el servidor se
pierde. Elija una de estas opciones (todo es opcional, pero se recomienda
fuertemente):

**Opción A: descargarlo a su computadora cada cierto tiempo.** Desde *su
computadora* (no desde el servidor):

```
scp ganga@IP_DEL_VPS:~/la-ganga/infrastructure/deploy/backups/NOMBRE_DEL_ARCHIVO.dump .
```

**Opción B: copia automática con `rclone`** (Google Drive, Dropbox, OneDrive,
almacenamiento S3, etc.):

```
sudo apt-get install -y rclone
rclone config
```

`rclone config` hace preguntas en pantalla para conectar su cuenta de nube (para
Drive o Dropbox le pedirá autorizar desde un navegador; siga las instrucciones
que muestra el propio programa). Cuando tenga un "remoto" creado (por ejemplo
llamado `mi-drive`), edite el archivo `.env` (`nano .env`) y agregue:

```
BACKUP_REMOTE=rclone:mi-drive:respaldos-la-ganga
BACKUP_REMOTE_KEEP_DAYS=90
```

**Opción C: copia automática a otro servidor con `scp`** (requiere una llave SSH
sin contraseña ya autorizada en el otro servidor):

```
BACKUP_REMOTE=scp:usuario@otro-servidor:/ruta/respaldos/
```

Después de configurar cualquiera de las opciones, ejecute `./backup.sh` y confirme
que aparece "Copia externa lista". Si la copia externa falla, el respaldo local
se conserva y el script avisa con un error en `backups/backup.log`.

> Los respaldos contienen **todos los datos de la tienda**. Trátelos como
> información confidencial: no los envíe por WhatsApp ni los deje en equipos
> compartidos.

> Si su plan de Hostinger ofrece copias de seguridad o instantáneas del VPS en el
> panel, actívelas **además** de lo anterior; no sustituyen los respaldos de la
> base de datos.

---

## 10. Probar una restauración

Un respaldo que nunca se probó no es un respaldo. Haga esta prueba **antes de
abrir la tienda** y repítala de vez en cuando.

### 10.1 Prueba segura (no toca los datos reales)

```
./restore.sh --solo-verificar
```

Muestra la lista de respaldos; presione Enter para elegir el más reciente. El
script comprueba el archivo, lo restaura en una base **temporal**, cuenta las
tablas y filas, y luego borra la temporal. Debe terminar con:

```
PRUEBA EXITOSA: este respaldo se puede restaurar. ...
```

### 10.2 Restauración real (solo en una emergencia, o como ensayo antes de abrir)

```
./restore.sh
```

Esto **reemplaza los datos actuales** por los del respaldo elegido; lo hecho
después de ese respaldo se pierde. Por eso:

- Pide que escriba la palabra **RESTAURAR** para continuar.
- Restaura primero en una base nueva y la valida.
- Guarda antes un respaldo de seguridad de lo que había (`antes-de-restaurar`).
- Detiene la API unos instantes, cambia las bases y la vuelve a encender.
- La base anterior queda guardada con un nombre como `la_ganga_antes_FECHA`; el
  script muestra el comando para borrarla cuando ya confirme que todo está bien.

**Ensayo recomendado antes de abrir:** como todavía no hay ventas, haga una
restauración real una vez con un respaldo reciente y verifique que puede entrar
con el administrador. Así sabrá que, si algún día la necesita, funciona.

---

## 11. Actualizar el sistema

Cuando el equipo de desarrollo publique una versión nueva:

```
cd ~/la-ganga/infrastructure/deploy
./update.sh
```

El script, en orden:

1. Descarga los cambios y le muestra qué se va a instalar.
2. Hace un **respaldo automático** (`antes-de-actualizar`).
3. Compila la versión nueva **sin apagar** la actual. Si la compilación falla, no
   cambia nada.
4. Reinicia con la versión nueva.
5. Espera a que la API esté saludable y comprueba el sitio.

Haga las actualizaciones **fuera del horario de venta** (el sistema queda fuera
de servicio unos segundos al reiniciar). Después, en cada caja, recargue la
página o cierre y vuelva a abrir la aplicación para recibir la versión nueva.

### Si la versión nueva falla: volver atrás

```
./update.sh --revertir
```

Vuelve al código anterior y lo reinicia (pide escribir `REVERTIR`). Esto **no
deshace cambios en la base de datos**: si la versión nueva alteró la base y el
sistema anterior no arranca, restaure el respaldo hecho justo antes de
actualizar con `./restore.sh` (elija el más reciente cuyo nombre termina en
`antes-de-actualizar`).

---

## 12. Si algo falla

Siempre primero, desde `~/la-ganga/infrastructure/deploy`:

```
docker compose -f compose.prod.yml ps
```

Los tres servicios deben estar `running` / `healthy`.

| Síntoma | Qué hacer |
|---|---|
| El sitio no abre o dice "no se puede conectar" | `docker compose -f compose.prod.yml ps`; `sudo ufw status` (deben verse 80 y 443); revise el firewall del panel de Hostinger |
| Error de certificado / "conexión no privada" | Verifique el DNS (`nslookup SU_DOMINIO` debe dar la IP del VPS). Ver logs: `docker compose -f compose.prod.yml logs --tail=80 web`. Si el DNS es correcto, espere unos minutos y recargue |
| Pantalla de error 502 / "bad gateway" | La API no responde: `docker compose -f compose.prod.yml logs --tail=100 api` |
| La API se reinicia sola | `docker compose -f compose.prod.yml logs --tail=100 api` y `... logs --tail=50 db` (casi siempre es la contraseña de la base o una configuración faltante) |
| "Contraseña incorrecta" al entrar | Revise mayúsculas; espere 1 minuto si falló varias veces seguidas. El administrador puede restablecer la contraseña de cualquier cuenta desde **Equipo** |
| Todo muy lento o se reinicia | `free -h` (memoria) y `df -h` (disco). Si el disco está lleno: `docker system df` y `docker image prune -f` |
| Quiere reiniciar todo | `docker compose -f compose.prod.yml restart` |
| Quiere apagar o encender | `docker compose -f compose.prod.yml stop` y luego `... start` |
| El servidor se reinició solo | Los contenedores arrancan solos (`restart: unless-stopped`). Revise con `ps` |
| El servidor no responde por SSH | Reinícielo desde el panel de Hostinger (**Acción humana**) |

Ver registros (logs) en vivo, y salir con `Ctrl+C`:

```
docker compose -f compose.prod.yml logs -f --tail=50
```

Para pedir ayuda, copie la salida de estos dos comandos (no incluya el archivo
`.env`):

```
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs --tail=100 api
```

**Sobre la contraseña de la base de datos:** PostgreSQL guarda la contraseña **la
primera vez** que se crea el volumen. Si cambia `POSTGRES_PASSWORD` en `.env`
después, la API fallará con "password authentication failed". Para cambiarla de
verdad hay que cambiarla también dentro de PostgreSQL (pida ayuda técnica). No
borre el volumen `pgdata`: contiene todos los datos.

---

## 13. Qué pasa si se cae internet

El punto de venta (POS) está diseñado para **seguir vendiendo sin conexión** y
sincronizar solo cuando vuelve la red.

**Antes de depender de esto (en cada caja):**

- Abra el POS **con internet** al menos una vez, al inicio de cada turno. Así el
  equipo descarga el catálogo y la información que necesita para trabajar sin
  red, y la aplicación instalada queda guardada en el equipo.
- Instale la aplicación (PWA) en cada caja (ver checklist).

**Qué ocurre cuando se cae internet (de la tienda o del servidor):**

- El POS muestra que está **sin conexión** y sigue funcionando: busca y escanea
  productos contra la copia local del catálogo.
- Cada venta se guarda **primero en el propio equipo** y queda *pendiente de
  sincronizar*. El sistema reintenta enviarla automáticamente; un reintento no
  duplica la venta.
- El recibo se imprime con los datos locales. Mientras no tenga el número oficial
  usa una referencia corta temporal (`#` y 6 caracteres).
- Cuando vuelve la conexión, las ventas pendientes se envían **solas**. Revise
  que el indicador de pendientes llegue a cero.

**Limitaciones a tener presentes:**

- **No se puede cerrar la caja** mientras haya ventas pendientes de envío:
  espere a que vuelva la conexión y se sincronicen.
- Los **descuentos mayores al límite** del vendedor requieren conexión
  (necesitan aprobación).
- El **panel de administración** (productos, reportes, equipo) necesita conexión.
- Una venta hecha sin conexión **siempre se acepta** al sincronizar (la prenda ya
  se entregó); si hay diferencias (por ejemplo, no alcanzaba el inventario, el
  precio cambió o la caja ya estaba cerrada), queda **marcada para revisión**
  del administrador.

**Consejos prácticos:**

- **No borre los datos del navegador ni desinstale la aplicación** si hay ventas
  pendientes: se perderían las ventas que aún no se enviaron.
- No apague ni reinicie el equipo con ventas pendientes sin antes conectarlo a
  internet. Es posible apagar, pero hay que volver a abrir el POS con conexión
  para que sincronice.
- Si el internet de la tienda es inestable, considere un plan de datos del celular
  como respaldo (compartir internet).
- Tenga un **plan B en papel** (cuaderno de ventas) por si un equipo falla por
  completo.

**Si lo que se cae es el servidor** (no el internet de la tienda): las cajas
siguen vendiendo igual. Revise el servidor con
`docker compose -f compose.prod.yml ps` (si no puede conectarse, reinícielo
desde el panel de Hostinger). Al volver, las cajas sincronizan solas.

---

## 14. Seguridad

- **Cambie las contraseñas** que usó durante la instalación si las compartió o
  las escribió en algún chat. La contraseña del administrador debe ser larga (12
  caracteres o más) y única.
- **No comparta cuentas.** Una persona, una cuenta. Cuando alguien deja la
  tienda, **desactive su cuenta** desde **Equipo** el mismo día.
- **Borre la contraseña del administrador del `.env`** después de crearlo
  (`./init-env.sh --quitar-admin`). El archivo `.env` nunca se sube a Git ni se
  comparte.
- **Guarde en un gestor de contraseñas** (o en papel bajo llave): la contraseña
  de root del VPS, la del usuario `ganga`, la del administrador del sistema y el
  acceso a la cuenta de Hostinger y al proveedor del dominio. Active la
  **verificación en dos pasos** en esas cuentas si está disponible.
- **Mantenga el servidor actualizado.** El script de preparación activa las
  actualizaciones automáticas de seguridad. Una vez al mes entre y ejecute:

  ```
  sudo apt-get update && sudo apt-get upgrade -y
  ```

  Si aparece el aviso de que el servidor "requiere reiniciar", hágalo fuera del
  horario de venta con `sudo reboot` (los servicios arrancan solos).
- **Firewall:** solo están abiertos SSH (22), 80 y 443. La base de datos **no**
  está expuesta a internet. No abra otros puertos.
- **fail2ban** bloquea direcciones que intentan adivinar contraseñas por SSH.
- (Recomendado, cuando ya domine el acceso) entrar por SSH con **llave** en lugar
  de contraseña, y desactivar el acceso directo de `root`. Pídale ayuda a una
  persona técnica: hacerlo mal puede dejarlo sin acceso al servidor.
- **Respaldos:** son datos confidenciales (ver paso 9). Guarde las copias externas
  en una cuenta protegida con verificación en dos pasos.
- **Equipos de la tienda:** use el navegador actualizado, bloquee la pantalla
  cuando nadie está en la caja y cierre la sesión al terminar el turno.

---

## 15. Checklist de salida a producción

Marque cada punto **antes de abrir al público (10 de noviembre de 2026)**.

**Infraestructura**
- [ ] El VPS cumple los requisitos y se anotaron las claves de root y de `ganga`.
- [ ] `https://SU_DOMINIO` abre con **candado** (SSL válido) y `/api/health` responde.
- [ ] `docker compose -f compose.prod.yml ps` muestra `db`, `api` y `web` en `healthy`.
- [ ] `sudo ufw status` muestra solo 22, 80 y 443.
- [ ] Se reinició el servidor (`sudo reboot`) y el sistema volvió a funcionar solo.

**Cuentas y contraseñas**
- [ ] Administrador creado y su contraseña guardada en un lugar seguro.
- [ ] Contraseña del administrador **borrada del `.env`** (`./init-env.sh --quitar-admin`).
- [ ] Una cuenta **por persona** creada en **Equipo** (rol Vendedor / Encargado de inventario).
- [ ] Ninguna cuenta compartida.

**Respaldos**
- [ ] `./install-cron.sh --estado` muestra el respaldo diario instalado.
- [ ] Se ejecutó `./backup.sh` y se creó un archivo con tamaño mayor a cero.
- [ ] **Se probó una restauración** (`./restore.sh --solo-verificar` terminó con "PRUEBA EXITOSA").
- [ ] (Recomendado) Hay una copia externa configurada (rclone/scp) o descargada a otra computadora.

**Cajas y operación**
- [ ] **Las 2 cajas probadas en 2 equipos distintos**, al mismo tiempo (abrir caja, vender, cerrar).
- [ ] La aplicación (PWA) **instalada en cada caja** (en el navegador: menú > "Instalar aplicación" / "Agregar a la pantalla de inicio").
- [ ] **Recibo de prueba impreso** en la impresora real de cada caja.
- [ ] Escáner de código de barras probado.
- [ ] **Modo sin conexión probado**: con el POS ya cargado, desconecte el internet del equipo, haga una venta de prueba, vuelva a conectar y verifique que se sincroniza sola.
- [ ] Se hizo una **venta de prueba y luego se anuló/ajustó** el inventario de prueba antes de cargar el inventario real.
- [ ] El personal sabe qué hacer si se cae internet (sección 13) y tiene el plan B en papel.

**Después de abrir**
- [ ] A la mañana siguiente, confirmar que el respaldo de las 2:00 a. m. se creó (`ls -lh backups`).

---

## 16. Recuperarse si el servidor se pierde

Si el VPS se daña o se borra, con una copia del respaldo (`.dump`) puede levantar
todo en un servidor nuevo:

1. Compre/cree un VPS nuevo y apunte el dominio a su nueva IP (pasos 2 y 3).
2. Repita los pasos 4 a 6 (preparar servidor, clonar, `./init-env.sh`,
   `docker compose -f compose.prod.yml up -d --build`).
3. Copie el archivo de respaldo al servidor nuevo, a la carpeta `backups/`
   (desde su computadora):

   ```
   scp NOMBRE_DEL_ARCHIVO.dump ganga@IP_NUEVA:~/la-ganga/infrastructure/deploy/backups/
   ```

4. Restaure:

   ```
   ./restore.sh backups/NOMBRE_DEL_ARCHIVO.dump
   ```

5. Entre al sistema con el administrador que existía en el respaldo. (No hace
   falta `--bootstrap-admin`: los usuarios vienen en el respaldo.) Borre del
   `.env` la contraseña del administrador que pidió `init-env.sh`:
   `./init-env.sh --quitar-admin`.

---

## 17. Referencia rápida de comandos

Todos desde `~/la-ganga/infrastructure/deploy`, como usuario `ganga`.

| Para... | Comando |
|---|---|
| Ver el estado | `docker compose -f compose.prod.yml ps` |
| Ver errores de la API | `docker compose -f compose.prod.yml logs --tail=100 api` |
| Ver errores de la web/SSL | `docker compose -f compose.prod.yml logs --tail=100 web` |
| Reiniciar todo | `docker compose -f compose.prod.yml restart` |
| Hacer un respaldo ahora | `./backup.sh` |
| Ver los respaldos | `ls -lh backups` |
| Probar una restauración | `./restore.sh --solo-verificar` |
| Restaurar de verdad | `./restore.sh` |
| Estado del respaldo automático | `./install-cron.sh --estado` |
| Actualizar | `./update.sh` |
| Volver a la versión anterior | `./update.sh --revertir` |
| Borrar clave del admin del `.env` | `./init-env.sh --quitar-admin` |
| Sincronizar roles (si lo piden) | `docker compose -f compose.prod.yml run --rm cli --sync-roles` |

**Archivos de este kit** (`infrastructure/deploy/`):

| Archivo | Para qué sirve |
|---|---|
| `compose.prod.yml` | Define los servicios: base de datos, API y web |
| `Dockerfile.api`, `Dockerfile.web`, `Caddyfile` | Cómo se construyen la API y la web, y la configuración del servidor web y SSL |
| `.env.example` | Plantilla de configuración (el real es `.env`, que no se sube a Git) |
| `init-env.sh` | Crea el `.env` de forma guiada |
| `setup-vps.sh` | Prepara un Ubuntu limpio (Docker, firewall, fail2ban, swap, zona horaria) |
| `backup.sh`, `restore.sh`, `install-cron.sh` | Respaldos, restauración y respaldo diario automático |
| `update.sh` | Actualizar o volver a la versión anterior |

**Qué incluyen las cabeceras de seguridad:** el servidor web fuerza HTTPS (HSTS),
impide que otras páginas incrusten el sistema, y limita desde dónde se puede
cargar código (solo del propio dominio). Si en el futuro una función nueva
(por ejemplo una fuente de letras externa) quedara bloqueada, el navegador lo
indica en su consola con el texto "Content-Security-Policy" y quien mantiene el
sistema debe ajustar la línea correspondiente en `Caddyfile`.
