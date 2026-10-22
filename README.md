# StoriesCreator (web)

Generador web de imágenes de publicidad para historias y estados (1080×1920, 9:16). Elegís una plantilla, cargás la oferta (porcentaje de descuento, 2x1, precio…), la imagen se genera sola y la podés retocar en un editor de canvas. Las imágenes marcadas como **“Lista para el bot”** quedan disponibles en una API protegida para que tu bot existente las tome y las publique.

- **Sin dependencias**: solo Node.js **22.13 o superior** (usa SQLite integrado). No hace falta `npm install`.
- Login con **contraseña + verificación en dos pasos (TOTP)** obligatoria.
- Editor: 35 plantillas (5 originales + 30 del catálogo), marca (logo, colores, tipografía, contacto), foto de producto, capas (texto, formas, imágenes), arrastrar / redimensionar / rotar, deshacer y rehacer, zonas seguras de historias.

- **Demo online sin servidor**: la misma interfaz corre como sitio estático y un *service worker* simula la API en el navegador (ver [Demo](#demo)).

## Cómo está hecho

| Parte | Detalle |
| --- | --- |
| Servidor | Node.js puro (`node:http`, `node:sqlite`, `node:crypto`), sin frameworks ni paquetes de npm |
| Interfaz | JavaScript con módulos ES, sin build; el DOM se arma con un helper propio (sin `innerHTML`) |
| Imagen | Canvas 2D a 1080×1920: plantillas, ajuste automático de textos, capas, recorte de fondos falsos |
| Seguridad | scrypt, TOTP con secretos cifrados (AES-256-GCM), sesiones hasheadas, CSRF, CSP estricta, auditoría |
| Bot | API con tokens revocables y reserva atómica para que ninguna imagen se publique dos veces |
| Pruebas | `node:test` contra el servidor real (login, 2FA, bloqueo, CSRF, aislamiento, ciclo del bot) |

## Demo

La carpeta `demo/` arma una versión estática para mostrar el editor sin instalar nada:

```bash
npm run build:demo        # genera dist-demo/
npx serve dist-demo       # o cualquier servidor estático
```

- `demo/sw.js` es un *service worker* que responde las rutas `/api/*` con los mismos formatos que el servidor y guarda todo en IndexedDB.
- No hay login: la sesión de demo siempre está activa y **Salir** borra los datos.
- Las imágenes marcadas como “Lista para el bot” pasan a “Publicada” a los pocos segundos, simulando al bot.
- Trae solo las plantillas básicas (las 5 originales + `Dividido`); el resto del catálogo no se publica en la demo. Se elige en `DEMO_CATALOG` dentro de `demo/build.mjs`.
- Incluye imágenes de ejemplo propias para el encabezado y el pie de página (`demo/assets/`).
- `vercel.json` ya está configurado: importando el repo en Vercel se publica la demo sin ajustes.

## Puesta en marcha

```bash
node server/cli.js user:add agustin      # pide la contraseña (mín. 12 caracteres); repetir para cada usuario
npm start                                # http://127.0.0.1:3000
npm run dev                              # igual, pero se reinicia solo al cambiar el código del servidor
```

Al primer ingreso cada usuario debe activar la verificación en dos pasos (app autenticadora → “ingresar clave de configuración”) y guarda 8 códigos de recuperación de un solo uso.

Comandos de administración (`node server/cli.js …`):

| Comando | Qué hace |
| --- | --- |
| `user:add <nombre>` | Crea un usuario (no hay registro público) |
| `user:passwd <nombre>` | Cambia la contraseña y cierra sus sesiones |
| `user:reset2fa <nombre>` | Reinicia el 2FA (si perdió el teléfono y los códigos) |
| `user:disable` / `user:enable <nombre>` | Bloquea o habilita una cuenta |
| `user:list` | Lista usuarios |
| `token:add <bot>` | Crea un token para el bot (se muestra una sola vez) |
| `token:list` / `token:revoke <id>` | Lista o revoca tokens |

## Pie de página con imágenes al azar

Copiá tus PNG (logos de juegos, sellos, etc.) en la carpeta `footer/`. En el estudio, el botón **“Pie de página al azar (3 imágenes)”** elige 3 al azar y las ubica abajo, superpuestas, con la del medio al frente. Cada una queda como capa editable, y volver a tocar el botón sortea otras (reemplaza el pie anterior). Se puede cambiar la carpeta con `FOOTER_DIR`.

## Encabezado con imagen al azar

Copiá imágenes (PNG, JPG o WebP) en la carpeta `header/`. El botón **“Encabezado al azar (1 imagen)”** del estudio elige una y la ubica arriba, a todo el ancho y detrás de los textos (capa editable; se puede mover, achicar o mandar adelante). Volver a tocarlo sortea otra distinta. Carpeta configurable con `HEADER_DIR`.

## Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT`, `HOST` | `3000`, `127.0.0.1` | Dónde escucha |
| `DATA_DIR` | `./data` | Base de datos, imágenes y clave de cifrado |
| `COOKIE_SECURE` | `0` | **Ponelo en `1` en producción (HTTPS)**: cookie `__Host-` con flag Secure + HSTS |
| `TRUST_PROXY` | `0` | `1` si hay un proxy inverso (usa `X-Forwarded-For` para limitar intentos) |
| `APP_SECRET` | (archivo `data/secret.key`) | Clave para cifrar los secretos TOTP en reposo |

## Publicarlo en internet (recomendado)

Poné un proxy con HTTPS delante y dejá el servidor escuchando solo en local. Ejemplo con Caddy (certificado automático):

```
stories.tudominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
COOKIE_SECURE=1 TRUST_PROXY=1 npm start
```

Hacé copias de seguridad de la carpeta `data/` (contiene la base, las imágenes y `secret.key`).

## API para el bot

Todas las rutas requieren `Authorization: Bearer sc_…` (token creado con `token:add`).

| Método y ruta | Descripción |
| --- | --- |
| `GET /api/bot/images?due=1&limit=20` | Imágenes “listas” cuya fecha de publicación ya llegó (`due=0` incluye las programadas a futuro). Devuelve `id, title, caption, publish_at, sha256, file` |
| `GET /api/bot/images/{id}/file` | Descarga el PNG (1080×1920) |
| `POST /api/bot/images/{id}/claim` | Reserva la imagen. Responde `409` si otro proceso ya la tomó (evita publicar dos veces) |
| `POST /api/bot/images/{id}/status` | `{"status":"published"}` o `{"status":"failed","note":"motivo"}` |

Ciclo de vida: `draft → ready → processing → published | failed`. Un ejemplo completo y listo para adaptar está en [`examples/bot-client.js`](examples/bot-client.js).

## Seguridad implementada

- Contraseñas con **scrypt** (N=32768), política de longitud/complejidad y comparación en tiempo constante; respuesta idéntica para usuario inexistente o clave errónea.
- **2FA TOTP obligatorio** (RFC 6238), sin reutilización de códigos, secretos cifrados con AES-256-GCM, códigos de recuperación hasheados y de un solo uso.
- **Bloqueo progresivo** por usuario (desde el 5.º fallo) y límites por IP y por usuario.
- Sesiones con id aleatorio de 256 bits guardado **hasheado**, cookie `HttpOnly` + `SameSite=Strict` (+ `Secure`/`__Host-` en producción), expiración por inactividad (30 min) y absoluta (12 h), rotación al subir de nivel, cierre remoto de sesiones.
- **CSRF**: token por sesión en cabecera + verificación de `Origin`.
- Cabeceras: CSP estricta (`script-src 'self'`, sin `unsafe-inline`), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, COOP/CORP, HSTS.
- Interfaz construida sin `innerHTML` (a prueba de XSS); validación estricta de PNG (firma, dimensiones, tamaño), logos y JSON; límites de tamaño de cuerpo.
- Cada usuario ve solo sus imágenes; el bot usa tokens propios (guardados hasheados, revocables) y reserva atómica.
- Registro de auditoría (`audit`) de accesos y acciones.

## Pruebas

```bash
npm test
```

Cubre login, 2FA, bloqueo, CSRF/origen, aislamiento entre usuarios, validación de imágenes y el ciclo completo con el bot.

## Notas

- No hay QR para el 2FA: se carga la clave manualmente en la app autenticadora.
- Las tipografías dependen de las instaladas en el dispositivo (Arial Black, Impact, Georgia…). La imagen se genera en el navegador, por lo que se ve igual que en la vista previa.
- `node:sqlite` es experimental en Node 22; si Node cambia su API, la base es un archivo SQLite estándar (`data/app.db`).

## Licencia

[MIT](LICENSE)
