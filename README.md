# Sistema de gestión comercial (Gestión Pro)

Segundo parcial: **Sistema de Gestión Comercial**. Sistema para un comercio que factura ventas, controla las
existencias del catálogo y lleva la cuenta corriente de sus clientes.

- **URL pública:** https://parcial-ventas.vercel.app/
- **API publicada (backend):** https://parcial-ventas-backend.vercel.app
- **Repositorio:** https://github.com/PbloRuiz/parcial-ventas

## Integrantes (grupo 17)

- Ruiz Pablo Emanuel — legajo 61324
- Valdez del Pino Valentín — legajo 63209

## Qué hace

- **Ventas / Caja:** nueva venta en una sola pantalla (se puede operar con el teclado: Tab, flechas y Enter), con consumidor
  final o cliente registrado; contado, tarjeta y cuenta corriente; comprobante imprimible o exportable a PDF.
- **Historial de ventas:** listado de facturas con su estado y anulación (solo administrador).
- **Productos y stock:** catálogo con alta y edición, y marca de stock bajo.
- **Clientes y cuenta corriente:** alta de clientes, límite de crédito, saldo calculado desde los movimientos y registro de pagos.
- **Usuarios y permisos:** dos roles (administrador y vendedor), alta, edición, activación y desactivación, con permisos
  verificados en el servidor.
- **Inicio (administrador):** ventas del día y del mes, deuda en cuentas corrientes, productos para reponer, ventas de los
  últimos 30 días, ventas por forma de pago y productos más vendidos.
- **Listados:** muestran estado de carga, de error (con botón para reintentar) y de lista vacía. La sesión se mantiene al
  recargar la página.

No incluye: factura electrónica fiscal, discriminación de IVA, cobro real con tarjeta ni compras a proveedores.

## Tecnologías

TypeScript · React con Vite y Tailwind CSS (frontend) · Node.js con Express (API REST) · Drizzle ORM con drizzle-kit ·
SQLite en desarrollo y Turso (libSQL) en producción · JWT (`jsonwebtoken`) para la sesión · bcrypt para las contraseñas ·
despliegue en Vercel (un proyecto para el frontend y otro para el backend).

## Instalación local

Requiere **Node.js 20 o superior** y npm. Hacen falta dos terminales (PowerShell). El repositorio tiene dos carpetas:
`backend` y `frontend`.

**Backend**

```powershell
cd backend
npm install
# Crear backend/.env con las variables de la sección "Variables de entorno"
npx drizzle-kit push
npx tsx src/db/seed.ts
npx tsx src/db/hashearPasswords.ts
npm run dev
```

El backend queda en http://localhost:3000.

- `drizzle-kit push` crea las tablas en la base configurada.
- `seed.ts` carga los datos de prueba. Guarda las contraseñas de prueba en texto plano.
- `hashearPasswords.ts` las encripta con bcrypt. Se puede correr más de una vez: saltea las que ya están encriptadas.

**Frontend**

```powershell
cd frontend
npm install
npm run dev
```

El frontend queda en http://localhost:5173. Si el backend corre en otra dirección, crear `frontend/.env` con
`VITE_API_URL=<url del backend>`.

## Variables de entorno

Se leen del archivo `.env` de cada carpeta. El archivo `.env` real nunca se sube a Git (está en `.gitignore`).

**Backend**

| Variable | Para qué sirve |
| --- | --- |
| `JWT_SECRET` | Clave que firma las sesiones. Obligatoria: sin ella el servidor no arranca. Es secreta. |
| `TURSO_DATABASE_URL` | URL `libsql://...` de la base en Turso. Si falta, se usa el archivo local `sistema_ventas.db`. |
| `TURSO_AUTH_TOKEN` | Token de acceso a la base de Turso. Es secreto. |
| `PORT` | Puerto del servidor local. Opcional (por defecto 3000). |

**Frontend**

| Variable | Para qué sirve |
| --- | --- |
| `VITE_API_URL` | Dirección del backend. Por defecto `http://localhost:3000`. En producción es la URL del backend en Vercel, sin barra final. |

El secreto de la sesión no está en el repositorio porque el repositorio es público: quien lo conociera podría fabricar
tokens falsos y entrar como administrador.

## Usuarios de prueba

El login tiene dos botones de acceso rápido, **Demo Administrador** y **Demo Vendedor**, que entran con estas cuentas:

| Rol | Email | Contraseña | Qué puede hacer |
| --- | --- | --- | --- |
| Administrador | `demo.admin@ventas.com` | `demo1234` | Todo: inicio, ventas, productos, clientes, historial y usuarios. |
| Vendedor | `demo.vendedor@ventas.com` | `demo1234` | Solo Ventas / Caja: vende y elige cliente, sin ver saldos. |

Las cuentas se crean desde la pantalla **Usuarios** (con un administrador). Sus datos están en el código del frontend;
sirven para la demostración y hay que eliminarlas antes de usar el sistema con datos reales.

## Base de datos

Las tablas están definidas en `backend/src/db/schema.ts`:

| Tabla | Contenido |
| --- | --- |
| `usuarios` | Nombre, email, contraseña encriptada, rol y si está activo. |
| `clientes` | Razón social, documento (único), contacto, estado y límite de crédito (0 = sin límite). |
| `productos` | Código (único), nombre, precio y stock. |
| `ventas` | Cabecera de la factura: número, fecha, cliente, total, forma de pago y si está anulada. |
| `detalles_venta` | Renglones de cada factura, con el precio y el nombre del producto del momento de la venta. |
| `movimientos_stock` | Cada entrada o salida de mercadería, con motivo y fecha. |
| `movimientos_cta_cte` | Cargos (deuda por venta) y abonos (pagos y anulaciones) de cada cliente. |

- **Importes en centavos:** se guardan como enteros ($18.500,50 se guarda como 1850050), porque los números con coma
  flotante no son exactos y acumularían errores de redondeo. La API recibe y devuelve pesos; el servidor convierte con
  `aCentavos()` y `aPesos()`.
- **Existencia y saldo:** el stock se guarda en `productos`. El saldo de un cliente se calcula (cargos menos abonos).
- **Cambios de estructura:** se editan en `schema.ts` y se aplican con `npx drizzle-kit push`.

## Reglas de negocio y dónde viven

Las reglas están en `backend/src/server.ts`; la pantalla solo llama a la API y nunca se confía en lo que envía.

| Regla | Dónde |
| --- | --- |
| El stock nunca queda negativo, ni con dos ventas simultáneas de la última unidad | `POST /api/ventas`: descuento condicionado (`stock >= cantidad`) dentro de la transacción |
| Toda venta deja su movimiento de stock | `POST /api/ventas` (salida) y `POST /api/ventas/:id/anular` (entrada), tabla `movimientos_stock` |
| El precio y el total los calcula el servidor | `POST /api/ventas`: solo recibe id de producto y cantidad, y busca el precio real en la base |
| El precio de la factura se congela | `detalles_venta` guarda `precioUnitario` y `nombreProducto` del momento |
| Numeración correlativa y sin huecos | `POST /api/ventas`: último id + 1 dentro de la transacción; punto de venta en la constante `PUNTO_VENTA` |
| La factura se graba completa o no se graba | `db.transaction` en `POST /api/ventas` |
| Una factura emitida no se modifica | No hay ruta de edición: solo `POST /api/ventas/:id/anular` |
| Anular no borra: revierte stock y deuda | `POST /api/ventas/:id/anular` (marca `anulada`, devuelve stock, abono en la cuenta) |
| No se vende en cuenta corriente a consumidor final | Validación en `POST /api/ventas` |
| Límite de crédito del cliente | `POST /api/ventas`, dentro de la transacción; se edita con `PUT /api/clientes/:id/limite` |
| El saldo se calcula, no se guarda | `GET /api/clientes` (cargos menos abonos de `movimientos_cta_cte`) |
| Un pago no puede superar la deuda | `POST /api/clientes/:id/pagos`, dentro de una transacción |
| Tarjeta: no se guarda ningún dato | Solo se guarda el texto `tarjeta` como forma de pago; el sistema no pide número ni código |
| Importes en centavos | `aCentavos()` y `aPesos()` en `server.ts` |
| Contraseñas encriptadas | bcrypt en `POST /api/login` y en el alta y edición de usuarios |
| Sesión y permisos | Filtros `requiereLogin` y `soloAdmin` en `server.ts` |
| Un usuario desactivado pierde el acceso al instante | `requiereLogin` consulta la base en cada pedido |

## API REST

Los errores se devuelven como `{ "error": "mensaje" }` con el código HTTP correspondiente: 400 (datos inválidos),
401 (sin sesión), 403 (sin permiso), 404 (no existe), 409 (valor repetido) y 500 (error interno). Se arman en
`responderError()`.

| Acceso | Método y ruta | Descripción |
| --- | --- | --- |
| Público | `POST /api/login` | Inicia sesión y devuelve el token (dura 2 horas). |
| Sesión | `GET /api/me` | Nombre y rol del usuario del token. |
| Sesión | `GET /api/productos` | Lista de productos. |
| Sesión | `GET /api/clientes` | Lista de clientes (el vendedor la recibe sin saldos). |
| Sesión | `POST /api/ventas` | Registra una venta. |
| Administrador | `POST /api/productos`, `PUT /api/productos/:id` | Alta y edición de productos. |
| Administrador | `GET /api/ventas` | Historial de facturas. |
| Administrador | `POST /api/ventas/:id/anular` | Anula una factura. |
| Administrador | `GET /api/dashboard` | Datos del panel de inicio. |
| Administrador | `POST /api/clientes`, `PUT /api/clientes/:id/limite` | Alta de clientes y límite de crédito. |
| Administrador | `GET /api/clientes/:id/movimientos` | Movimientos de la cuenta corriente. |
| Administrador | `POST /api/clientes/:id/pagos` | Registra un pago. |
| Administrador | `GET /api/usuarios`, `POST /api/usuarios` | Lista y alta de usuarios. |
| Administrador | `PUT /api/usuarios/:id`, `DELETE /api/usuarios/:id` | Edición y eliminación. |
| Administrador | `PUT /api/usuarios/:id/activo` | Activa o desactiva un usuario. |

Las rutas de "Sesión" y de "Administrador" exigen el encabezado `Authorization: Bearer <token>`.

## Arquitectura

```
parcial-ventas/
├── backend/
│   ├── drizzle.config.ts            # configuración de Drizzle
│   ├── vercel.json                  # manda todos los pedidos a src/server.ts en Vercel
│   └── src/
│       ├── server.ts                # rutas, filtros de sesión y reglas de negocio
│       └── db/
│           ├── schema.ts            # tablas
│           ├── index.ts             # conexión: Turso si hay URL remota, archivo local si no
│           ├── seed.ts              # datos de prueba
│           └── hashearPasswords.ts  # encripta contraseñas en texto plano
└── frontend/
    └── src/
        └── App.tsx                  # login, menú lateral y todas las pantallas
```

El frontend y el backend son dos aplicaciones separadas que se comunican por la API REST. El frontend guarda el token en
el navegador y lo envía en cada pedido con la función `apiFetch`.

## Publicación en Vercel + Turso

La base corre en Turso y la aplicación en Vercel, como **dos proyectos** conectados al mismo repositorio.

### 1. Crear la base en Turso

1. En https://app.turso.tech crear una base de datos.
2. Copiar la **URL** de la base. La de este proyecto es `libsql://parcial-ventas-pbloruiz.aws-sa-east-1.turso.io`.
3. Generar un **token** de lectura y escritura. Es secreto: no se escribe en el código ni en Git.

### 2. Crear las tablas y cargar los datos en Turso

En la carpeta `backend`, con las variables cargadas solo en esa ventana de terminal:

```powershell
$env:TURSO_DATABASE_URL = "libsql://parcial-ventas-pbloruiz.aws-sa-east-1.turso.io"; $env:TURSO_AUTH_TOKEN = Get-Clipboard
npx drizzle-kit push
npx tsx src/db/seed.ts
npx tsx src/db/hashearPasswords.ts
```

`Get-Clipboard` toma el token del portapapeles, así no queda escrito en la terminal.

### 3. Backend en Vercel

1. En https://vercel.com elegir **Add New → Project**, importar el repositorio y usar `backend` como carpeta raíz.
   `vercel.json` manda todos los pedidos a `src/server.ts`, que exporta la aplicación de Express (`app.listen` solo
   corre fuera de producción).
2. En **Settings → Environment Variables** cargar `JWT_SECRET`, `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`.

### 4. Frontend en Vercel

1. Importar el mismo repositorio como otro proyecto, con `frontend` como carpeta raíz.
2. Cargar la variable `VITE_API_URL` con la dirección del backend.

### 5. Publicar

Vercel despliega solo cada vez que se sube código a la rama de producción configurada en cada proyecto. Si se cambia una
variable de entorno, hay que volver a desplegar (**Deployments → Redeploy**).

### Cómo comprobar que el sitio publicado usa Turso

Cargar un producto desde la URL pública y buscarlo en el panel de Turso (Edit Data, tabla `productos`). Además, el disco
de Vercel no persiste entre pedidos, por lo que una base local no guardaría nada.

## Limitaciones conocidas

- Las estructuras de la base se aplican con `drizzle-kit push`, sin archivos de migración versionados.
- El token de sesión dura 2 horas y no se renueva solo; se guarda en el navegador.
- Las credenciales de las cuentas demo están en el código del frontend.
- El stock mínimo es el mismo para todos los productos.
