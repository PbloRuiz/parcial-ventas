import { useState, useEffect } from 'react';

// CONFIGURACIÓN DE CONEXIÓN AL BACKEND:
// Si la app está subida a Vercel, lee la variable de entorno VITE_API_URL.
// Si estás trabajando en tu computadora, usa automáticamente http://localhost:3000.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const apiFetch = (url: string, options: RequestInit = {}) =>
  fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${localStorage.getItem('token')}`,
    },
  });

// CUENTAS DE DEMOSTRACIÓN: permiten entrar con un clic desde el login.
// Son usuarios creados solo para la demo (no son los usuarios reales del sistema).
const DEMO_ADMIN = { email: 'demo.admin@ventas.com', password: 'demo1234' };
const DEMO_VENDEDOR = { email: 'demo.vendedor@ventas.com', password: 'demo1234' };

// 1. DEFINICIÓN DE TIPOS (TypeScript)
// Son los "moldes" que le explican a React qué forma exacta tienen los datos
// que viajan desde y hacia la base de datos SQLite.

interface Producto {
  id: number;
  codigo: string;
  nombre: string;
  precio: number;
  stock: number;
}

// Molde para cada renglón que vamos agregando al ticket antes de confirmar la venta
interface ItemCarrito {
  idProducto: number;
  codigo: string;
  nombre: string;
  precio: number;
  cantidad: number;
  subtotal: number;
}

// Molde para la Factura / Comprobante imprimible que se genera al confirmar la venta
interface DatosFactura {
  comprobante: string;
  fecha: string;
  clienteNombre: string;
  clienteDocumento: string;
  formaPago: string;
  items: ItemCarrito[];
  total: number;
}

// Molde para los clientes registrados (el 'saldo' lo calcula el backend sumando cargos y restando pagos)
interface Cliente {
  id: number;
  razonSocial: string;
  documento: string;
  contacto: string | null;
  saldo: number;
  limiteCredito: number; // tope de deuda en cuenta corriente (0 = sin límite)
}

// Molde para cada movimiento de la Cuenta Corriente ("cargo" = deuda por venta, "abono" = pago recibido)
interface MovimientoCtaCte {
  id: number;
  clienteId: number;
  fecha: string;
  tipo: 'cargo' | 'abono';
  importe: number;
  observacion: string | null;
  ventaId: number | null;
}

interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: string;
  activo?: boolean; // true = puede iniciar sesión, false = desactivado
}

// Molde de lo que devuelve GET /api/dashboard (resumen del negocio, importes en pesos)
interface DatosDashboard {
  ventasHoy: { total: number; cantidad: number };
  ventasMes: { total: number; cantidad: number; ticketPromedio: number };
  deuda: { total: number; clientesConSaldo: number };
  stockMinimo: number;
  bajoStock: { id: number; codigo: string; nombre: string; stock: number }[];
  ventasDiarias: { fecha: string; total: number }[]; // fecha en formato AAAA-MM-DD
  porFormaPago: { formaPago: string; total: number }[];
  masVendidos: { codigo: string; nombre: string; unidades: number; importe: number }[];
}

// Molde para cada fila del historial de ventas (cabecera de la factura + nombre del cliente)
interface VentaHistorial {
  id: number;
  numeroComprobante: string;
  fecha: string;
  total: number;
  formaPago: string;
  anulada: boolean;
  cliente: string;
}


// 2. COMPONENTES AISLADOS (VISTAS DEL SISTEMA)
// Al definirlos fuera de "App", evitamos que React los destruya y vuelva a crear
// en cada clic, mejorando el rendimiento y evitando errores de ESLint.


// VISTA 1: PANTALLA DE VENTAS (Punto de Venta + Generación de Factura PDF)
const VistaVentas = ({
  productos,
  clientes,
  recargarProductos,
  recargarClientes,
}: {
  productos: Producto[];
  clientes: Cliente[];
  recargarProductos: () => void;
  recargarClientes: () => void;
}) => {
  // Estados propios del carrito y del formulario de nueva venta
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [productoSeleccionado, setProductoSeleccionado] = useState('');
  const [cantidad, setCantidad] = useState<number>(1);
  const [clienteId, setClienteId] = useState<string>(''); // Vacío ('') representa "Consumidor Final"
  const [formaPago, setFormaPago] = useState('contado');
  const [procesando, setProcesando] = useState(false);

  // Estados para mostrar e imprimir la Factura generada
  const [facturaGenerada, setFacturaGenerada] = useState<DatosFactura | null>(null);
  const [ultimaFactura, setUltimaFactura] = useState<DatosFactura | null>(null);

  // Función que valida y agrega un renglón al ticket de venta (todavía en memoria, sin guardar en BD)
  const agregarAlCarrito = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productoSeleccionado) return alert('Por favor, seleccioná un producto.');
    if (cantidad < 1) return alert('La cantidad debe ser mayor a 0.');

    const prod = productos.find((p) => p.id === parseInt(productoSeleccionado));
    if (!prod) return;

    // Verificamos si ese producto ya estaba cargado en el ticket para sumar cantidades
    const indiceExistente = carrito.findIndex((item) => item.idProducto === prod.id);
    const cantidadAcumulada =
      (indiceExistente >= 0 ? carrito[indiceExistente].cantidad : 0) + cantidad;

    // VALIDACIÓN DE STOCK TOTAL
    if (cantidadAcumulada > prod.stock) {
      return alert(`Stock insuficiente. Solo quedan ${prod.stock} unidades de ${prod.nombre}.`);
    }

    if (indiceExistente >= 0) {
      const carritoActualizado = [...carrito];
      carritoActualizado[indiceExistente] = {
        ...carritoActualizado[indiceExistente],
        cantidad: cantidadAcumulada,
        subtotal: prod.precio * cantidadAcumulada,
      };
      setCarrito(carritoActualizado);
    } else {
      const nuevoItem: ItemCarrito = {
        idProducto: prod.id,
        codigo: prod.codigo,
        nombre: prod.nombre,
        precio: prod.precio,
        cantidad: cantidad,
        subtotal: prod.precio * cantidad,
      };
      setCarrito([...carrito, nuevoItem]);
    }

    setProductoSeleccionado('');
    setCantidad(1);
  };

  // Elimina un renglón del ticket
  const quitarDelCarrito = (index: number) => {
    setCarrito(carrito.filter((_, i) => i !== index));
  };

  // Suma los subtotales para obtener el total general
  const totalVenta = carrito.reduce((total, item) => total + item.subtotal, 0);

  // Busca el cliente seleccionado para mostrarlo en el resumen y en la factura
  const clienteObj = clienteId ? clientes.find((c) => c.id === Number(clienteId)) : undefined;
  const clienteActualNombre = clienteObj ? clienteObj.razonSocial : 'Consumidor Final';

  const etiquetaFormaPago: Record<string, string> = {
    contado: 'Contado / Efectivo',
    tarjeta: 'Tarjeta (Débito/Crédito)',
    cuenta_corriente: 'Cuenta Corriente',
  };

  // Envía la venta definitiva al servidor Express y abre la Factura lista para imprimir/PDF
  const manejarConfirmarVenta = async () => {
    if (formaPago === 'cuenta_corriente' && !clienteId) {
      return alert('Para vender en Cuenta Corriente debés seleccionar un cliente registrado.');
    }

    setProcesando(true);
    try {
      const respuesta = await apiFetch(`${API_URL}/api/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Solo se envía QUÉ se vende (id y cantidad). El precio, los subtotales y el total
        // los calcula el servidor con los precios reales de la base de datos.
        body: JSON.stringify({
          clienteId: clienteId ? Number(clienteId) : null,
          formaPago,
          carrito: carrito.map((item) => ({ idProducto: item.idProducto, cantidad: item.cantidad })),
        }),
      });

      const datos = await respuesta.json();

      if (respuesta.ok) {
        // Armamos el comprobante formal con los datos de la operación recién confirmada
        const nuevaFactura: DatosFactura = {
          comprobante:
            datos.comprobante ||
            (datos.id ? `0001-${String(datos.id).padStart(8, '0')}` : '0001-00000001'),
          fecha: new Date().toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
          clienteNombre: clienteObj ? clienteObj.razonSocial : 'Consumidor Final',
          clienteDocumento: clienteObj ? clienteObj.documento : '99-99999999-9',
          formaPago: etiquetaFormaPago[formaPago] || formaPago.toUpperCase(),
          items: [...carrito],
          // El total oficial es el que calculó el servidor
          total: typeof datos.total === 'number' ? datos.total : totalVenta,
        };

        setFacturaGenerada(nuevaFactura);
        setUltimaFactura(nuevaFactura);

        // Limpiamos la pantalla y actualizamos stock y saldos
        setCarrito([]);
        setClienteId('');
        setFormaPago('contado');
        recargarProductos();
        recargarClientes();
      } else {
        alert(`Error: ${datos.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('Error de conexión con el servidor.');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <>
      {/* Estilos de impresión: oculta toda la web y deja únicamente la hoja de la factura al guardar PDF */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #factura-imprimible, #factura-imprimible * { visibility: visible; }
          #factura-imprimible {
            position: fixed;
            left: 0;
            top: 0;
            width: 100%;
            max-width: 100%;
            margin: 0;
            padding: 20px;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Botón superior para reabrir y reimprimir la última factura emitida */}
      {ultimaFactura && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setFacturaGenerada(ultimaFactura)}
            className="flex items-center gap-2 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 font-bold text-xs px-4 py-2 rounded-lg shadow-xs transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Reimprimir Última Factura ({ultimaFactura.comprobante})</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* PANEL IZQUIERDO: Formulario para seleccionar cliente, productos y forma de pago */}
        <div className="lg:col-span-5 bg-white p-6 rounded-xl shadow-sm border border-slate-200/80 h-fit">
          <h2 className="text-lg font-black mb-5 text-slate-800">Nueva Venta</h2>

          {/* Selector de Cliente */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Cliente</label>
            <select
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-600 outline-none"
            >
              <option value="">Consumidor Final</option>
              {clientes.map((cli) => (
                <option key={cli.id} value={cli.id}>
                  {cli.razonSocial} ({cli.documento})
                </option>
              ))}
            </select>
          </div>

          {/* Sub-formulario para ir cargando productos al carrito */}
          <form
            onSubmit={agregarAlCarrito}
            className="mb-4 bg-slate-50/80 p-4 rounded-xl border border-slate-200"
          >
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Producto</label>
            <select
              value={productoSeleccionado}
              onChange={(e) => setProductoSeleccionado(e.target.value)}
              className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 mb-3 focus:ring-2 focus:ring-blue-600 outline-none"
            >
              <option value="">-- Seleccionar --</option>
              {productos
                .filter((p) => p.stock > 0)
                .map((prod) => (
                  <option key={prod.id} value={prod.id}>
                    {prod.nombre} (${prod.precio.toLocaleString('es-AR')}) - Stock: {prod.stock}
                  </option>
                ))}
            </select>

            <label className="block text-xs font-bold text-slate-700 mb-1.5">Cantidad</label>
            <input
              type="number"
              min="1"
              value={cantidad}
              onChange={(e) => setCantidad(parseInt(e.target.value) || 1)}
              className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 mb-4 focus:ring-2 focus:ring-blue-600 outline-none"
            />

            <button
              type="submit"
              className="w-full bg-blue-600 text-white font-bold text-sm py-2.5 rounded-lg hover:bg-blue-700 transition shadow-xs"
            >
              Agregar al Detalle
            </button>
          </form>

          {/* Selector de Medio de Pago */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Forma de Pago</label>
            <select
              value={formaPago}
              onChange={(e) => setFormaPago(e.target.value)}
              className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-600 outline-none"
            >
              <option value="contado">Contado / Efectivo</option>
              <option value="tarjeta">Tarjeta (Débito/Crédito)</option>
              <option value="cuenta_corriente">Cuenta Corriente</option>
            </select>
          </div>
        </div>

        {/* PANEL DERECHO: Vista previa del comprobante / ticket */}
        <div className="lg:col-span-7 bg-white p-6 rounded-xl shadow-sm border border-slate-200/80 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-black mb-5 text-slate-800">Detalle del Comprobante</h2>

            <div className="min-h-[250px] border border-slate-200 rounded-xl bg-slate-50/70 p-4 mb-5">
              {carrito.length === 0 ? (
                <p className="text-slate-400 text-sm text-center mt-24">
                  No hay productos en la venta actual.
                </p>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-300 text-slate-600 text-xs uppercase">
                      <th className="pb-2">Producto</th>
                      <th className="pb-2 text-center">Cant.</th>
                      <th className="pb-2 text-right">Unitario</th>
                      <th className="pb-2 text-right">Subtotal</th>
                      <th className="pb-2 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carrito.map((item, index) => (
                      <tr key={index} className="border-b border-slate-200">
                        <td className="py-3 font-medium text-slate-800">{item.nombre}</td>
                        <td className="py-3 text-center text-slate-700">{item.cantidad}</td>
                        <td className="py-3 text-right text-slate-600">
                          ${item.precio.toLocaleString('es-AR')}
                        </td>
                        <td className="py-3 text-right font-bold text-slate-800">
                          ${item.subtotal.toLocaleString('es-AR')}
                        </td>
                        <td className="py-3 text-center">
                          <button
                            onClick={() => quitarDelCarrito(index)}
                            className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1 rounded hover:bg-red-50"
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Pie del ticket con resumen y botón de confirmación */}
          <div className="flex flex-wrap justify-between items-end gap-4 pt-2 border-t border-slate-100">
            <div className="text-sm space-y-0.5">
              <p className="text-slate-600">
                Cliente: <span className="font-bold text-slate-800">{clienteActualNombre}</span>
              </p>
              <p className="text-slate-600">
                Pago:{' '}
                <span className="font-bold text-slate-800 uppercase">
                  {formaPago.replace('_', ' ')}
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500 font-medium">Total a cobrar</p>
              <p className="text-3xl font-black text-emerald-600">
                ${totalVenta.toLocaleString('es-AR')}
              </p>

              <button
                className={`mt-3 px-7 py-2.5 rounded-lg font-bold text-sm text-white shadow-sm transition ${
                  carrito.length === 0 || procesando
                    ? 'bg-slate-400 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
                disabled={carrito.length === 0 || procesando}
                onClick={manejarConfirmarVenta}
              >
                {procesando ? 'Generando Factura...' : 'Confirmar Venta'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* MODAL DE FACTURA / COMPROBANTE COMERCIAL IMPRIMIBLE (EXPORTABLE PDF) */}
      {/* ==================================================================== */}
      {facturaGenerada && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div
            id="factura-imprimible"
            className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
          >
            {/* Encabezado estilo Factura C */}
            <div className="p-6 sm:p-8 border-b border-slate-200 flex justify-between items-start gap-4 bg-slate-50/70">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black text-sm">
                    GP
                  </div>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Gestión Pro</h2>
                </div>
                <p className="text-xs text-slate-500 mt-2">Sistema de Gestión Comercial</p>
                <p className="text-xs text-slate-500">San Miguel de Tucumán, Argentina</p>
                <p className="text-xs text-slate-500">IVA Responsable Monotributo</p>
              </div>

              {/* Letra oficial de comprobante */}
              <div className="border-2 border-slate-800 px-4 py-1.5 text-center bg-white">
                <span className="text-2xl font-black text-slate-900 block leading-none">C</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  COD. 011
                </span>
              </div>

              <div className="text-right">
                <span className="inline-block bg-blue-100 text-blue-800 text-[11px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded">
                  Factura
                </span>
                <p className="text-sm font-black text-slate-800 mt-1.5">
                  N° {facturaGenerada.comprobante}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Fecha: <strong>{facturaGenerada.fecha}</strong>
                </p>
              </div>
            </div>

            {/* Datos del Cliente y Condición de Venta */}
            <div className="px-6 sm:px-8 py-4 bg-white border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-400 uppercase font-bold text-[10px]">
                  Cliente / Razón Social
                </p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">
                  {facturaGenerada.clienteNombre}
                </p>
                <p className="text-slate-500 mt-0.5">
                  CUIT / DNI: <strong>{facturaGenerada.clienteDocumento}</strong>
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-slate-400 uppercase font-bold text-[10px]">Condición de Venta</p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">
                  {facturaGenerada.formaPago}
                </p>
                <p className="text-emerald-600 font-semibold mt-0.5">Comprobante Registrado</p>
              </div>
            </div>

            {/* Detalle de Ítems Facturados */}
            <div className="p-6 sm:p-8">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-800 text-slate-700 uppercase text-[11px]">
                    <th className="py-2">Código</th>
                    <th className="py-2">Descripción</th>
                    <th className="py-2 text-center">Cant.</th>
                    <th className="py-2 text-right">P. Unit.</th>
                    <th className="py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {facturaGenerada.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2.5 text-slate-500 font-mono text-xs">{item.codigo}</td>
                      <td className="py-2.5 font-medium text-slate-800">{item.nombre}</td>
                      <td className="py-2.5 text-center text-slate-700">{item.cantidad}</td>
                      <td className="py-2.5 text-right text-slate-600">
                        ${item.precio.toLocaleString('es-AR')}
                      </td>
                      <td className="py-2.5 text-right font-bold text-slate-900">
                        ${item.subtotal.toLocaleString('es-AR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Total Final */}
              <div className="mt-6 pt-4 border-t-2 border-slate-800 flex justify-between items-center">
                <p className="text-xs text-slate-500">
                  Documento válido como comprobante de operación comercial.
                </p>
                <div className="text-right">
                  <span className="text-xs font-bold uppercase text-slate-500 mr-3">Total</span>
                  <span className="text-2xl font-black text-slate-900">
                    ${facturaGenerada.total.toLocaleString('es-AR')}
                  </span>
                </div>
              </div>
            </div>

            {/* Botonera (se oculta automáticamente al imprimir o guardar PDF) */}
            <div className="no-print px-6 sm:px-8 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setFacturaGenerada(null)}
                className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-200/70 transition"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-5 py-2 rounded-lg shadow-sm transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span>Imprimir / Guardar PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};


// VISTA 2: PANTALLA DE PRODUCTOS Y STOCK
const VistaProductos = ({
  productos,
  recargarProductos,
  cargando,
  error,
}: {
  productos: Producto[];
  recargarProductos: () => void;
  cargando: boolean; // true mientras se piden los productos al servidor
  error: boolean; // true si el pedido falló
}) => {
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [productoEditando, setProductoEditando] = useState<number | null>(null);

  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [stock, setStock] = useState('');

  //Recarga el formulario
  const iniciarEdicion = (prod: {
    id: number;
    codigo: string;
    nombre: string;
    precio: number;
    stock: number;
  }) => {
    setProductoEditando(prod.id);
    setCodigo(prod.codigo);
    setNombre(prod.nombre);
    setPrecio(String(prod.precio));
    setStock(String(prod.stock));
    setMostrarFormulario(true);
  };
  //Limpia el formulario y cierra la vista de edición
  const cancelarFormulario = () => {
    setMostrarFormulario(false);
    setProductoEditando(null);
    setCodigo('');
    setNombre('');
    setPrecio('');
    setStock('');
  };
  //envio dinamico a POST vs PUT
  //Es el controlador de evento onSubmit del formulario
  const manejarGuardar = async (e: React.FormEvent) => {
    e.preventDefault();

    const url = productoEditando
      ? `${API_URL}/api/productos/${productoEditando}`
      : `${API_URL}/api/productos`;

    const metodo = productoEditando ? 'PUT' : 'POST';

    try {
      const respuesta = await apiFetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo,
          nombre,
          precio: Number(precio),
          stock: Number(stock),
        }),
      });

      if (respuesta.ok) {
        alert(
          productoEditando
            ? 'Producto actualizado exitosamente.'
            : 'Producto registrado exitosamente.'
        );
        cancelarFormulario();
        recargarProductos();
      } else {
        const datos = await respuesta.json();
        alert(`Error: ${datos.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('Error de conexión con el servidor.');
    }
  };

  return (
    <div>
    
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-black text-slate-800">Listado de Artículos</h2>
        <button
          onClick={() => (mostrarFormulario ? cancelarFormulario() : setMostrarFormulario(true))}
          className={`${
            mostrarFormulario ? 'bg-slate-500 hover:bg-slate-600' : 'bg-emerald-600 hover:bg-emerald-700'
          } text-white px-4 py-2 rounded-lg text-sm font-bold shadow-xs transition`}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo Producto'}
        </button>
      </div>

      {mostrarFormulario && (
        <div
          className={`bg-white p-6 rounded-xl shadow-sm mb-6 border-t-4 ${
            productoEditando ? 'border-amber-500' : 'border-emerald-600'
          }`}
        >
          <h3 className="text-lg font-bold mb-4 text-slate-800">
            {productoEditando ? 'Editar Producto' : 'Registrar Nuevo Producto'}
          </h3>
          <form onSubmit={manejarGuardar} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Código</label>
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                required
                placeholder="Ej. AG-2027"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Nombre del Producto
              </label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                required
                placeholder="Ej. Agenda Diaria"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Precio Unitario ($)
              </label>
              <input
                type="number"
                min="0"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Stock Inicial</label>
              <input
                type="number"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>
            <div className="sm:col-span-2 flex justify-end mt-2">
              <button
                type="submit"
                className={`${
                  productoEditando
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                } text-white font-bold text-sm py-2.5 px-8 rounded-lg transition shadow-xs`}
              >
                {productoEditando ? 'Actualizar Producto' : 'Guardar Producto'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200/80">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-800 text-white text-xs uppercase">
              <th className="p-3.5">Código</th>
              <th className="p-3.5">Producto</th>
              <th className="p-3.5">Precio</th>
              <th className="p-3.5">Stock</th>
              <th className="p-3.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {/* Los tres estados de un listado: cargando, con error y vacío */}
            {cargando && productos.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-400">
                  Cargando productos...
                </td>
              </tr>
            )}
            {!cargando && error && productos.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-red-600">
                  No se pudieron cargar los productos.{' '}
                  <button type="button" onClick={recargarProductos} className="underline font-bold">
                    Reintentar
                  </button>
                </td>
              </tr>
            )}
            {!cargando && !error && productos.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-400">
                  No hay productos cargados todavía.
                </td>
              </tr>
            )}
            {productos.map((prod) => (
              <tr key={prod.id} className="hover:bg-slate-50">
                <td className="p-3.5 font-mono text-xs font-bold text-slate-600">{prod.codigo}</td>
                <td className="p-3.5 font-medium text-slate-800">{prod.nombre}</td>
                <td className="p-3.5 font-semibold text-slate-700">
                  ${prod.precio.toLocaleString('es-AR')}
                </td>
                <td className="p-3.5">
                  <span
                    className={
                      prod.stock < 20
                        ? 'text-red-700 font-bold bg-red-100 px-2.5 py-1 rounded-full text-xs'
                        : 'text-emerald-700 font-bold bg-emerald-100 px-2.5 py-1 rounded-full text-xs'
                    }
                  >
                    {prod.stock} un.
                  </span>
                </td>
                <td className="p-3.5 text-right">
                  <button
                    type="button"
                    onClick={() => iniciarEdicion(prod)}
                    className="bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold text-xs px-3 py-1.5 rounded-lg transition"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};


// VISTA 3: PANTALLA DE CLIENTES Y CUENTAS CORRIENTES
const VistaClientes = ({
  clientes,
  recargarClientes,
  cargando,
  error,
}: {
  clientes: Cliente[];
  recargarClientes: () => void;
  cargando: boolean; // true mientras se piden los clientes al servidor
  error: boolean; // true si el pedido falló
}) => {
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [razonSocial, setRazonSocial] = useState('');
  const [documento, setDocumento] = useState('');
  const [contacto, setContacto] = useState('');
  const [limiteCredito, setLimiteCredito] = useState(''); // vacío o 0 = sin límite

  const [clienteDetalle, setClienteDetalle] = useState<Cliente | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoCtaCte[]>([]);
  const [importePago, setImportePago] = useState('');
  const [observacionPago, setObservacionPago] = useState('');

  const manejarGuardarCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const respuesta = await apiFetch(`${API_URL}/api/clientes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razonSocial, documento, contacto, limiteCredito: Number(limiteCredito) || 0 }),
      });

      if (respuesta.ok) {
        alert('Cliente registrado exitosamente.');
        setMostrarFormulario(false);
        setRazonSocial('');
        setDocumento('');
        setContacto('');
        setLimiteCredito('');
        recargarClientes();
      } else {
        const datos = await respuesta.json();
        alert(`Error: ${datos.error}`);
      }
    } catch {
      alert('Error de conexión con el servidor.');
    }
  };

  // Cambia el límite de crédito de un cliente (0 = sin límite)
  const cambiarLimite = async (cli: Cliente) => {
    const texto = window.prompt(
      `Nuevo límite de crédito para ${cli.razonSocial} (0 = sin límite):`,
      String(cli.limiteCredito ?? 0)
    );
    if (texto === null) return; // tocó "Cancelar"

    const valor = Number(texto);
    if (!(valor >= 0)) return alert('Ingresá un número mayor o igual a 0.');

    try {
      const respuesta = await apiFetch(`${API_URL}/api/clientes/${cli.id}/limite`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limiteCredito: valor }),
      });

      if (respuesta.ok) {
        recargarClientes();
      } else {
        const datos = await respuesta.json();
        alert(`Error: ${datos.error}`);
      }
    } catch {
      alert('Error de conexión con el servidor.');
    }
  };

  const abrirDetalleCuenta = async (cli: Cliente) => {
    setClienteDetalle(cli);
    try {
      const resp = await apiFetch(`${API_URL}/api/clientes/${cli.id}/movimientos`);
      const datos = await resp.json();
      setMovimientos(datos);
    } catch {
      alert('Error al cargar movimientos de cuenta corriente.');
    }
  };

  const manejarRegistrarPago = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteDetalle) return;

    try {
      const resp = await apiFetch(`${API_URL}/api/clientes/${clienteDetalle.id}/pagos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importe: Number(importePago),
          observacion: observacionPago || 'Entrega en efectivo',
        }),
      });

      if (resp.ok) {
        alert('Pago registrado en cuenta corriente.');
        setImportePago('');
        setObservacionPago('');
        recargarClientes();
        const respMovs = await apiFetch(`${API_URL}/api/clientes/${clienteDetalle.id}/movimientos`);
        const datosMovs = await respMovs.json();
        setMovimientos(datosMovs);
      } else {
        const datos = await resp.json();
        alert(`Error: ${datos.error}`);
      }
    } catch {
      alert('Error de conexión con el servidor.');
    }
  };

  const saldoActualDetalle = movimientos.reduce(
    (acc, m) => (m.tipo === 'cargo' ? acc + m.importe : acc - m.importe),
    0
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-black text-slate-800">Cartera de Clientes</h2>
        <button
          onClick={() => setMostrarFormulario(!mostrarFormulario)}
          className={`${
            mostrarFormulario ? 'bg-slate-500 hover:bg-slate-600' : 'bg-blue-600 hover:bg-blue-700'
          } text-white px-4 py-2 rounded-lg text-sm font-bold shadow-xs transition`}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo Cliente'}
        </button>
      </div>

      {mostrarFormulario && (
        <div className="bg-white p-6 rounded-xl shadow-sm mb-6 border-t-4 border-blue-600">
          <h3 className="text-lg font-bold mb-4 text-slate-800">Registrar Nuevo Cliente</h3>
          <form onSubmit={manejarGuardarCliente} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Razón Social / Nombre
              </label>
              <input
                type="text"
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
                placeholder="Ej. Librería San Martín"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">CUIT / DNI</label>
              <input
                type="text"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
                placeholder="Ej. 20-35123456-7"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Contacto / Tel.</label>
              <input
                type="text"
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ej. 381-5551234"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Límite de Crédito ($)
              </label>
              <input
                type="number"
                min="0"
                value={limiteCredito}
                onChange={(e) => setLimiteCredito(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0 = sin límite"
              />
            </div>
            <div className="sm:col-span-4 flex justify-end mt-2">
              <button
                type="submit"
                className="bg-blue-600 text-white font-bold text-sm py-2.5 px-8 rounded-lg hover:bg-blue-700 transition shadow-xs"
              >
                Guardar Cliente
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200/80 mb-8">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-800 text-white text-xs uppercase">
              <th className="p-3.5">Razón Social</th>
              <th className="p-3.5">CUIT / DNI</th>
              <th className="p-3.5">Contacto</th>
              <th className="p-3.5 text-right">Límite de Crédito</th>
              <th className="p-3.5 text-right">Saldo Deudor</th>
              <th className="p-3.5 text-center">Cuenta Corriente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && clientes.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-400">
                  Cargando clientes...
                </td>
              </tr>
            )}
            {!cargando && error && clientes.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-red-600">
                  No se pudieron cargar los clientes.{' '}
                  <button type="button" onClick={recargarClientes} className="underline font-bold">
                    Reintentar
                  </button>
                </td>
              </tr>
            )}
            {!cargando && !error && clientes.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-400">
                  No hay clientes registrados todavía.
                </td>
              </tr>
            )}
            {clientes.map((cli) => (
              <tr key={cli.id} className="hover:bg-slate-50">
                <td className="p-3.5 font-semibold text-slate-800">{cli.razonSocial}</td>
                <td className="p-3.5 text-slate-600">{cli.documento}</td>
                <td className="p-3.5 text-slate-600">{cli.contacto || '-'}</td>
                <td className="p-3.5 text-right text-slate-700 font-semibold">
                  {cli.limiteCredito > 0 ? `$${cli.limiteCredito.toLocaleString('es-AR')}` : 'Sin límite'}
                </td>
                <td className="p-3.5 text-right">
                  <span
                    className={
                      cli.saldo > 0
                        ? 'text-red-700 font-bold bg-red-100 px-2.5 py-1 rounded-full text-xs'
                        : 'text-emerald-700 font-bold bg-emerald-100 px-2.5 py-1 rounded-full text-xs'
                    }
                  >
                    ${cli.saldo.toLocaleString('es-AR')}
                  </span>
                </td>
                <td className="p-3.5 text-center">
                  <button
                    onClick={() => abrirDetalleCuenta(cli)}
                    className="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition font-bold"
                  >
                    Ver Movimientos / Pagar
                  </button>
                  <button
                    onClick={() => cambiarLimite(cli)}
                    className="ml-2 bg-slate-100 text-slate-700 text-xs px-3 py-1.5 rounded-lg hover:bg-slate-200 transition font-bold"
                  >
                    Límite
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {clienteDetalle && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200/80 border-t-4 border-t-indigo-600">
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-lg font-black text-slate-800">
                Estado de Cuenta: {clienteDetalle.razonSocial}
              </h3>
              <p className="text-xs text-slate-500">Documento: {clienteDetalle.documento}</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-[11px] text-slate-500 uppercase font-bold">Saldo Actual</p>
                <p
                  className={`text-2xl font-black ${
                    saldoActualDetalle > 0 ? 'text-red-600' : 'text-emerald-600'
                  }`}
                >
                  ${saldoActualDetalle.toLocaleString('es-AR')}
                </p>
              </div>
              <button
                onClick={() => setClienteDetalle(null)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg px-2"
              >
                ✕
              </button>
            </div>
          </div>

          <form
            onSubmit={manejarRegistrarPago}
            className="flex flex-wrap gap-4 items-end bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6"
          >
            <div className="w-full sm:w-1/4">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Importe a Abonar ($)
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={importePago}
                onChange={(e) => setImportePago(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                required
                placeholder="0.00"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-slate-700 mb-1">Observación</label>
              <input
                type="text"
                value={observacionPago}
                onChange={(e) => setObservacionPago(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Ej. Pago parcial efectivo / Transferencia"
              />
            </div>
            <button
              type="submit"
              className="bg-emerald-600 text-white font-bold text-sm py-2.5 px-6 rounded-lg hover:bg-emerald-700 transition shadow-xs"
            >
              Registrar Pago
            </button>
          </form>

          <h4 className="font-bold text-slate-700 text-sm mb-3">Historial de Movimientos</h4>
          {movimientos.length === 0 ? (
            <p className="text-slate-400 text-sm py-4">
              Este cliente aún no registra movimientos en cuenta corriente.
            </p>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-xs uppercase text-slate-600">
                  <th className="p-2.5">Fecha</th>
                  <th className="p-2.5">Tipo</th>
                  <th className="p-2.5">Concepto</th>
                  <th className="p-2.5 text-right">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movimientos.map((mov) => (
                  <tr key={mov.id}>
                    <td className="p-2.5 text-slate-600">
                      {new Date(mov.fecha).toLocaleDateString('es-AR')}
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${
                          mov.tipo === 'cargo'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {mov.tipo === 'cargo' ? 'Cargo (Deuda)' : 'Abono (Pago)'}
                      </span>
                    </td>
                    <td className="p-2.5 text-slate-700">{mov.observacion || '-'}</td>
                    <td
                      className={`p-2.5 text-right font-bold ${
                        mov.tipo === 'cargo' ? 'text-red-600' : 'text-emerald-600'
                      }`}
                    >
                      {mov.tipo === 'cargo' ? '+' : '-'}${mov.importe.toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};


// VISTA 4: PANTALLA DE USUARIOS DEL SISTEMA (con botones Editar y Eliminar)
const VistaUsuarios = () => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  // Empieza en true: se apaga cuando termina el primer pedido al servidor
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false); // true si el pedido de usuarios falló
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  // Guarda el id del usuario que se está editando (null = se está creando uno nuevo)
  const [usuarioEditando, setUsuarioEditando] = useState<number | null>(null);

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('vendedor');

  // Al cambiar este número, el efecto vuelve a pedir la lista de usuarios
  const [recarga, setRecarga] = useState(0);
  const cargarUsuarios = () => setRecarga((n) => n + 1);

  useEffect(() => {
    const obtenerUsuarios = async () => {
      try {
        const respuesta = await apiFetch(`${API_URL}/api/usuarios`);
        const datos = await respuesta.json();
        if (respuesta.ok && Array.isArray(datos)) {
          setUsuarios(datos);
          setError(false);
        } else {
          setError(true);
        }
      } catch {
        console.error('Error al obtener usuarios');
        setError(true);
      } finally {
        setCargando(false);
      }
    };
    obtenerUsuarios();
  }, [recarga]);

  // Carga los datos del usuario en el formulario (la contraseña queda vacía)
  const iniciarEdicion = (user: Usuario) => {
    setUsuarioEditando(user.id);
    setNombre(user.nombre);
    setEmail(user.email);
    setPassword('');
    setRol(user.rol);
    setMostrarFormulario(true);
  };

  // Limpia el formulario y lo cierra
  const cancelarFormulario = () => {
    setMostrarFormulario(false);
    setUsuarioEditando(null);
    setNombre('');
    setEmail('');
    setPassword('');
    setRol('vendedor');
  };

  // Crea (POST) o edita (PUT) según si hay un usuario en edición
  const manejarGuardar = async (e: React.FormEvent) => {
    e.preventDefault();

    const url = usuarioEditando
      ? `${API_URL}/api/usuarios/${usuarioEditando}`
      : `${API_URL}/api/usuarios`;
    const metodo = usuarioEditando ? 'PUT' : 'POST';

    // Al editar, la contraseña es opcional: si está vacía, no se envía y no se cambia
    const cuerpo: Record<string, string> = { nombre, email, rol };
    if (!usuarioEditando || password) cuerpo.password = password;

    try {
      const respuesta = await apiFetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });

      if (respuesta.ok) {
        alert(
          usuarioEditando
            ? 'Usuario actualizado exitosamente.'
            : 'Usuario registrado exitosamente.'
        );
        cancelarFormulario();
        cargarUsuarios();
      } else {
        const datos = await respuesta.json();
        alert(`Error: ${datos.error}`);
      }
    } catch {
      alert('Error de conexión con el servidor.');
    }
  };

  // Activa o desactiva un usuario SIN borrarlo (un usuario desactivado no puede iniciar sesión)
  const cambiarEstado = async (user: Usuario) => {
    const nuevoEstado = !user.activo; // si estaba activo lo desactiva, y al revés
    const accion = nuevoEstado ? 'activar' : 'desactivar';
    if (!window.confirm(`¿Querés ${accion} a ${user.nombre}?`)) return;

    try {
      const respuesta = await apiFetch(`${API_URL}/api/usuarios/${user.id}/activo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: nuevoEstado }),
      });

      if (respuesta.ok) {
        cargarUsuarios(); // vuelve a pedir la lista para ver el nuevo estado
      } else {
        const datos = await respuesta.json();
        alert(`Error: ${datos.error}`); // ej.: "No podés desactivarte a vos mismo."
      }
    } catch {
      alert('Error de conexión con el servidor.');
    }
  };

  // Elimina un usuario, pidiendo confirmación antes
  const eliminarUsuario = async (user: Usuario) => {
    if (!window.confirm(`¿Eliminar a ${user.nombre}? Esta acción no se puede deshacer.`)) return;

    try {
      const respuesta = await apiFetch(`${API_URL}/api/usuarios/${user.id}`, {
        method: 'DELETE',
      });

      if (respuesta.ok) {
        alert('Usuario eliminado.');
        if (usuarioEditando === user.id) cancelarFormulario();
        cargarUsuarios();
      } else {
        const datos = await respuesta.json();
        alert(`Error: ${datos.error}`);
      }
    } catch {
      alert('Error de conexión con el servidor.');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-black text-slate-800">Operadores Habilitados</h2>
        <button
          onClick={() => (mostrarFormulario ? cancelarFormulario() : setMostrarFormulario(true))}
          className={`${
            mostrarFormulario ? 'bg-slate-500 hover:bg-slate-600' : 'bg-blue-600 hover:bg-blue-700'
          } text-white px-4 py-2 rounded-lg text-sm font-bold shadow-xs transition`}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo Usuario'}
        </button>
      </div>

      {mostrarFormulario && (
        <div
          className={`bg-white p-6 rounded-xl shadow-sm mb-6 border-t-4 ${
            usuarioEditando ? 'border-amber-500' : 'border-blue-600'
          }`}
        >
          <h3 className="text-lg font-bold mb-4 text-slate-800">
            {usuarioEditando ? 'Editar Usuario' : 'Registrar Nuevo Acceso'}
          </h3>
          <form onSubmit={manejarGuardar} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Nombre Completo</label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {usuarioEditando ? 'Contraseña nueva (opcional)' : 'Contraseña'}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required={!usuarioEditando}
                placeholder={usuarioEditando ? 'Dejar vacía para no cambiarla' : ''}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Rol</label>
              <select
                value={rol}
                onChange={(e) => setRol(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="vendedor">Vendedor</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div className="sm:col-span-2 flex justify-end mt-2">
              <button
                type="submit"
                className={`${
                  usuarioEditando ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'
                } text-white font-bold text-sm py-2.5 px-8 rounded-lg transition shadow-xs`}
              >
                {usuarioEditando ? 'Actualizar Usuario' : 'Guardar Usuario'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200/80">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-800 text-white text-xs uppercase">
              <th className="p-3.5">Nombre</th>
              <th className="p-3.5">Email</th>
              <th className="p-3.5">Rol</th>
              <th className="p-3.5">Estado</th>
              <th className="p-3.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-400">
                  Cargando usuarios...
                </td>
              </tr>
            )}
            {!cargando && error && usuarios.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-red-600">
                  No se pudieron cargar los usuarios.{' '}
                  <button type="button" onClick={cargarUsuarios} className="underline font-bold">
                    Reintentar
                  </button>
                </td>
              </tr>
            )}
            {!cargando && !error && usuarios.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-400">
                  No hay usuarios registrados.
                </td>
              </tr>
            )}
            {usuarios.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50">
                <td className="p-3.5 font-semibold text-slate-800">{user.nombre}</td>
                <td className="p-3.5 text-slate-600">{user.email}</td>
                <td className="p-3.5">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      user.rol === 'admin'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {user.rol.toUpperCase()}
                  </span>
                </td>
                <td className="p-3.5">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      user.activo === false
                        ? 'bg-red-100 text-red-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {user.activo === false ? 'INACTIVO' : 'ACTIVO'}
                  </span>
                </td>
                <td className="p-3.5 text-right space-x-2">
                  <button
                    type="button"
                    onClick={() => iniciarEdicion(user)}
                    className="bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold text-xs px-3 py-1.5 rounded-lg transition"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => cambiarEstado(user)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3 py-1.5 rounded-lg transition"
                  >
                    {user.activo === false ? 'Activar' : 'Desactivar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => eliminarUsuario(user)}
                    className="bg-red-100 hover:bg-red-200 text-red-700 font-bold text-xs px-3 py-1.5 rounded-lg transition"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};


// VISTA 5: HISTORIAL DE VENTAS (solo administradores) + ANULACIÓN DE FACTURAS
const VistaHistorial = ({
  recargarProductos,
  recargarClientes,
}: {
  recargarProductos: () => void;
  recargarClientes: () => void;
}) => {
  const [ventas, setVentas] = useState<VentaHistorial[]>([]);
  // Empieza en true: se apaga cuando termina el primer pedido al servidor
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false); // true si el pedido de ventas falló

  // Al cambiar este número, el efecto vuelve a pedir la lista de ventas
  const [recarga, setRecarga] = useState(0);
  const cargarVentas = () => setRecarga((n) => n + 1);

  useEffect(() => {
    const obtenerVentas = async () => {
      try {
        const respuesta = await apiFetch(`${API_URL}/api/ventas`);
        const datos = await respuesta.json();
        if (respuesta.ok && Array.isArray(datos)) {
          setVentas(datos);
          setError(false);
        } else {
          setError(true);
        }
      } catch {
        console.error('Error al obtener ventas');
        setError(true);
      } finally {
        setCargando(false);
      }
    };
    obtenerVentas();
  }, [recarga]);

  const etiquetaFormaPago: Record<string, string> = {
    contado: 'Contado / Efectivo',
    tarjeta: 'Tarjeta',
    cuenta_corriente: 'Cuenta Corriente',
  };

  // Anula la venta: el servidor devuelve el stock y compensa la deuda (no borra nada)
  const anularVenta = async (venta: VentaHistorial) => {
    if (
      !window.confirm(
        `¿Anular la factura ${venta.numeroComprobante}? Se devuelve el stock y, si era cuenta corriente, se compensa la deuda.`
      )
    )
      return;

    try {
      const respuesta = await apiFetch(`${API_URL}/api/ventas/${venta.id}/anular`, {
        method: 'POST',
      });

      if (respuesta.ok) {
        alert('Venta anulada correctamente.');
        cargarVentas();
        recargarProductos();
        recargarClientes();
      } else {
        const datos = await respuesta.json();
        alert(`Error: ${datos.error}`);
      }
    } catch {
      alert('Error de conexión con el servidor.');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-black text-slate-800">Facturas Emitidas</h2>
        <button
          onClick={cargarVentas}
          className="bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 font-bold text-xs px-4 py-2 rounded-lg shadow-xs transition"
        >
          Actualizar
        </button>
      </div>

      <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200/80">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-800 text-white text-xs uppercase">
              <th className="p-3.5">N° Factura</th>
              <th className="p-3.5">Fecha</th>
              <th className="p-3.5">Cliente</th>
              <th className="p-3.5">Pago</th>
              <th className="p-3.5 text-right">Total</th>
              <th className="p-3.5 text-center">Estado</th>
              <th className="p-3.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-400">
                  Cargando ventas...
                </td>
              </tr>
            ) : error && ventas.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-red-600">
                  No se pudieron cargar las ventas.{' '}
                  <button type="button" onClick={cargarVentas} className="underline font-bold">
                    Reintentar
                  </button>
                </td>
              </tr>
            ) : ventas.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-400">
                  Todavía no hay ventas registradas.
                </td>
              </tr>
            ) : (
              ventas.map((v) => (
                <tr key={v.id} className={v.anulada ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}>
                  <td className="p-3.5 font-mono text-xs font-bold">{v.numeroComprobante}</td>
                  <td className="p-3.5">{new Date(v.fecha).toLocaleString('es-AR')}</td>
                  <td className="p-3.5 font-medium">{v.cliente}</td>
                  <td className="p-3.5">{etiquetaFormaPago[v.formaPago] || v.formaPago}</td>
                  <td className="p-3.5 text-right font-bold">${v.total.toLocaleString('es-AR')}</td>
                  <td className="p-3.5 text-center">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        v.anulada ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {v.anulada ? 'ANULADA' : 'VÁLIDA'}
                    </span>
                  </td>
                  <td className="p-3.5 text-right">
                    {!v.anulada && (
                      <button
                        type="button"
                        onClick={() => anularVenta(v)}
                        className="bg-red-100 hover:bg-red-200 text-red-700 font-bold text-xs px-3 py-1.5 rounded-lg transition"
                      >
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};


// Formatos del panel de inicio: $ 1.363.800,00 (completo) y $ 250 mil / $ 1,4 M (para los ejes)
const pesos = (n: number) =>
  '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pesosCorto = (n: number) => {
  if (n >= 1000000) return `$ ${(n / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  if (n >= 1000) return `$ ${Math.round(n / 1000).toLocaleString('es-AR')} mil`;
  return `$ ${Math.round(n)}`;
};

// "2026-11-22" -> "22/11"
const etiquetaDia = (fecha: string) => {
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}`;
};

const NOMBRES_PAGO: Record<string, string> = {
  contado: 'Contado',
  tarjeta: 'Tarjeta',
  cuenta_corriente: 'Cuenta corriente',
};
const COLORES_PAGO: Record<string, string> = {
  contado: '#1d4ed8', // azul fuerte
  tarjeta: '#38bdf8', // celeste
  cuenta_corriente: '#6366f1', // índigo
};

// VISTA 0: PANEL DE INICIO (solo administradores): resumen del negocio
const VistaInicio = ({
  nombre,
  irA,
}: {
  nombre: string;
  irA: (vista: string) => void; // cambia de pantalla (para "Nueva venta" y "Ver todos")
}) => {
  const [datos, setDatos] = useState<DatosDashboard | null>(null);
  // Empieza en true: se apaga cuando termina el primer pedido al servidor
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  // Al cambiar este número, el efecto vuelve a pedir los datos
  const [recarga, setRecarga] = useState(0);
  const recargar = () => setRecarga((n) => n + 1);

  useEffect(() => {
    const obtenerDatos = async () => {
      try {
        const respuesta = await apiFetch(`${API_URL}/api/dashboard`);
        const json = await respuesta.json();
        if (respuesta.ok && json && json.ventasHoy) {
          setDatos(json);
          setError(false);
        } else {
          setError(true);
        }
      } catch {
        console.error('Error al obtener el panel de inicio');
        setError(true);
      } finally {
        setCargando(false);
      }
    };
    obtenerDatos();
  }, [recarga]);

  const fechaHoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const encabezado = (
    <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 text-white rounded-2xl px-6 py-6 mb-6 flex flex-wrap justify-between items-center gap-4 shadow-md shadow-blue-900/20">
      <div>
        <h2 className="text-2xl font-black tracking-tight">Hola, {nombre}</h2>
        <p className="text-sm text-blue-200 mt-1 capitalize">{fechaHoy}</p>
      </div>
      <button
        onClick={() => irA('ventas')}
        className="bg-white text-blue-900 hover:bg-blue-50 text-sm font-black px-5 py-2.5 rounded-lg shadow-md transition"
      >
        Nueva venta
      </button>
    </div>
  );

  if (cargando) {
    return (
      <div>
        {encabezado}
        <p className="text-slate-400 text-sm">Cargando panel...</p>
      </div>
    );
  }

  if (error || !datos) {
    return (
      <div>
        {encabezado}
        <p className="text-red-600 text-sm">
          No se pudo cargar el panel de inicio.{' '}
          <button type="button" onClick={recargar} className="underline font-bold">
            Reintentar
          </button>
        </p>
      </div>
    );
  }

  // --- Datos para el gráfico de barras (ventas diarias) ---
  const maximo = Math.max(...datos.ventasDiarias.map((d) => d.total), 1);
  const marcasEje = [1, 0.75, 0.5, 0.25, 0].map((f) => maximo * f);

  // --- Datos para el gráfico de anillo (forma de pago): cada tramo empieza donde terminó el anterior ---
  const totalPago = datos.porFormaPago.reduce((acc, p) => acc + p.total, 0);
  const segmentos = datos.porFormaPago
    .filter((p) => p.total > 0)
    .reduce<{ formaPago: string; total: number; pct: number; desde: number }[]>((lista, p) => {
      const pct = totalPago > 0 ? (p.total / totalPago) * 100 : 0;
      const ultimo = lista[lista.length - 1];
      const desde = ultimo ? ultimo.desde + ultimo.pct : 0;
      return [...lista, { formaPago: p.formaPago, total: p.total, pct, desde }];
    }, []);

  return (
    <div>
      {encabezado}

      {/* TARJETAS DE RESUMEN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 border-t-4 border-t-blue-600 shadow-sm">
          <p className="text-sm text-slate-500">Ventas de hoy</p>
          <p className="text-2xl font-black text-blue-900 mt-1">{pesos(datos.ventasHoy.total)}</p>
          <p className="text-xs text-slate-500 mt-1">{datos.ventasHoy.cantidad} facturas</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 border-t-4 border-t-indigo-600 shadow-sm">
          <p className="text-sm text-slate-500">Ventas del mes</p>
          <p className="text-2xl font-black text-blue-900 mt-1">{pesos(datos.ventasMes.total)}</p>
          <p className="text-xs text-slate-500 mt-1">
            {datos.ventasMes.cantidad} facturas · ticket promedio {pesos(datos.ventasMes.ticketPromedio)}
          </p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 border-t-4 border-t-sky-500 shadow-sm">
          <p className="text-sm text-slate-500">Deuda en cuentas corrientes</p>
          <p className="text-2xl font-black text-blue-900 mt-1">{pesos(datos.deuda.total)}</p>
          <p className="text-xs text-slate-500 mt-1">{datos.deuda.clientesConSaldo} clientes con saldo</p>
        </div>
        <div className="bg-blue-50 p-5 rounded-xl border border-blue-200 border-t-4 border-t-blue-900 shadow-sm">
          <p className="text-sm text-slate-600">Bajo stock mínimo</p>
          <p className="text-2xl font-black text-blue-900 mt-1">{datos.bajoStock.length}</p>
          <p className="text-xs text-slate-500 mt-1">Productos para reponer</p>
        </div>
      </div>

      {/* GRÁFICOS: ventas diarias y forma de pago */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Ventas diarias</h3>
          <p className="text-sm text-slate-500 mb-5">Últimos 30 días</p>
          <div className="flex">
            <div className="flex flex-col justify-between h-48 pr-3 text-[11px] text-slate-400 text-right shrink-0">
              {marcasEje.map((m, i) => (
                <span key={i}>{pesosCorto(m)}</span>
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-end gap-1 h-48 border-b border-l border-slate-200">
                {datos.ventasDiarias.map((d) => (
                  <div
                    key={d.fecha}
                    className="flex-1 h-full flex items-end"
                    title={`${etiquetaDia(d.fecha)}: ${pesos(d.total)}`}
                  >
                    <div
                      className="w-full bg-blue-300 hover:bg-blue-600 rounded-t transition-colors"
                      style={{ height: `${(d.total / maximo) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-1 mt-1 text-[11px] text-slate-400">
                {datos.ventasDiarias.map((d, i) => (
                  <div key={d.fecha} className="flex-1 text-center whitespace-nowrap">
                    {i % 5 === 0 ? etiquetaDia(d.fecha) : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Por forma de pago</h3>
          <p className="text-sm text-slate-500 mb-4 capitalize">
            {new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
          </p>
          <div className="relative w-44 h-44 mx-auto mb-5">
            <svg viewBox="0 0 42 42" className="absolute inset-0 w-full h-full -rotate-90">
              <circle cx="21" cy="21" r="15.915" fill="none" stroke="#dbeafe" strokeWidth="6" />
              {segmentos.map((seg) => (
                <circle
                  key={seg.formaPago}
                  cx="21"
                  cy="21"
                  r="15.915"
                  fill="none"
                  stroke={COLORES_PAGO[seg.formaPago] || '#94a3b8'}
                  strokeWidth="6"
                  strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
                  strokeDashoffset={-seg.desde}
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xs text-slate-500">Total</span>
              <span className="text-lg font-black text-blue-900">{pesosCorto(totalPago)}</span>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            {segmentos.length === 0 && (
              <p className="text-slate-400 text-center">Todavía no hay ventas este mes.</p>
            )}
            {segmentos.map((seg) => (
              <div key={seg.formaPago} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-slate-700">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: COLORES_PAGO[seg.formaPago] || '#94a3b8' }}
                  ></span>
                  {NOMBRES_PAGO[seg.formaPago] || seg.formaPago}
                </span>
                <span className="text-slate-400">{Math.round(seg.pct)}%</span>
                <span className="font-semibold text-slate-800">{pesos(seg.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MÁS VENDIDOS Y PARA REPONER */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Más vendidos del mes</h3>
          <p className="text-sm text-slate-500 mb-4">Por unidades</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-blue-50 text-blue-900 text-sm">
                  <th className="p-3">#</th>
                  <th className="p-3">Producto</th>
                  <th className="p-3 text-right">Unidades</th>
                  <th className="p-3 text-right">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {datos.masVendidos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-slate-400">
                      Todavía no hay ventas este mes.
                    </td>
                  </tr>
                )}
                {datos.masVendidos.map((p, i) => (
                  <tr key={p.codigo + i}>
                    <td className="p-3 text-blue-400 font-bold">{i + 1}</td>
                    <td className="p-3">
                      <p className="font-medium text-slate-800">{p.nombre}</p>
                      <p className="text-xs font-mono text-slate-400">{p.codigo}</p>
                    </td>
                    <td className="p-3 text-right text-slate-700">{p.unidades}</td>
                    <td className="p-3 text-right font-semibold text-slate-800">{pesos(p.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm">
          <div className="flex justify-between items-start">
            <h3 className="text-lg font-bold text-slate-900">Para reponer</h3>
            <button
              type="button"
              onClick={() => irA('productos')}
              className="text-sm font-bold text-blue-600 hover:text-blue-800"
            >
              Ver todos →
            </button>
          </div>
          <p className="text-sm text-slate-500 mb-4">Productos bajo el stock mínimo</p>
          <div className="space-y-4">
            {datos.bajoStock.length === 0 && (
              <p className="text-sm text-slate-400">No hay productos para reponer.</p>
            )}
            {datos.bajoStock.slice(0, 6).map((p) => (
              <div key={p.id} className="flex justify-between items-start gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{p.nombre}</p>
                  <p className="text-xs font-mono text-slate-400">{p.codigo}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="inline-block bg-red-100 text-red-700 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    {p.stock} · bajo mínimo
                  </span>
                  <p className="text-xs text-slate-400 mt-1">mínimo {datos.stockMinimo}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};


// ============================================================================
// 3. COMPONENTE PRINCIPAL (CEREBRO Y NAVEGACIÓN DE LA APLICACIÓN)
// ============================================================================
function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [cargando, setCargando] = useState(false);

  const [estaLogueado, setEstaLogueado] = useState(false);
  const [nombreUsuario, setNombreUsuario] = useState('');
  // Rol del usuario que inició sesión ('admin' o 'vendedor'): define qué pantallas ve
  const [rolUsuario, setRolUsuario] = useState('');
  const esAdmin = rolUsuario === 'admin';
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  // Indican si todavía se está esperando la respuesta del servidor (para mostrar "Cargando...")
  const [cargandoProductos, setCargandoProductos] = useState(false);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [errorProductos, setErrorProductos] = useState(false); // true si falló el pedido de productos
  const [errorClientes, setErrorClientes] = useState(false); // true si falló el pedido de clientes
  // true mientras se verifica el token guardado al abrir o recargar la página
  const [restaurandoSesion, setRestaurandoSesion] = useState(() => !!localStorage.getItem('token'));

  const [vistaActual, setVistaActual] = useState('inicio');

  const obtenerProductos = async () => {
    setCargandoProductos(true);
    try {
      const respuesta = await apiFetch(`${API_URL}/api/productos`);
      const datos = await respuesta.json();
      if (respuesta.ok && Array.isArray(datos)) {
        setProductos(datos);
        setErrorProductos(false);
      } else {
        setErrorProductos(true);
      }
    } catch (error) {
      console.error('Error al cargar productos:', error);
      setErrorProductos(true);
    } finally {
      setCargandoProductos(false); // pase lo que pase, se apaga el cartel
    }
  };

  const obtenerClientes = async () => {
    setCargandoClientes(true);
    try {
      const respuesta = await apiFetch(`${API_URL}/api/clientes`);
      const datos = await respuesta.json();
      if (respuesta.ok && Array.isArray(datos)) {
        setClientes(datos);
        setErrorClientes(false);
      } else {
        setErrorClientes(true);
      }
    } catch (error) {
      console.error('Error al cargar clientes:', error);
      setErrorClientes(true);
    } finally {
      setCargandoClientes(false);
    }
  };

  // Cambia de pantalla y la guarda en el navegador, así al recargar (F5) vuelve a la misma sección
  const cambiarVista = (vista: string) => {
    setVistaActual(vista);
    localStorage.setItem('vista', vista);
  };

  // AL ABRIR O RECARGAR LA PÁGINA (F5): si hay un token guardado, se le pregunta al servidor
  // quién es y se vuelve a entrar solo, sin pedir la contraseña otra vez.
  useEffect(() => {
    const restaurarSesion = async () => {
      if (!localStorage.getItem('token')) return; // no hay sesión guardada: se muestra el login

      try {
        const respuesta = await apiFetch(`${API_URL}/api/me`);

        if (!respuesta.ok) {
          // Token vencido (dura 2 horas) o usuario desactivado/eliminado: se descarta
          localStorage.removeItem('token');
          return;
        }

        const datos = await respuesta.json();
        setNombreUsuario(datos.usuario.nombre);
        setRolUsuario(datos.usuario.rol);
        // Vuelve a la sección donde estaba, pero solo si su rol puede verla
        const esAdminRestaurado = datos.usuario.rol === 'admin';
        const permitidas = esAdminRestaurado
          ? ['inicio', 'ventas', 'productos', 'clientes', 'historial', 'usuarios']
          : ['ventas'];
        const guardada = localStorage.getItem('vista') || '';
        setVistaActual(
          permitidas.includes(guardada) ? guardada : esAdminRestaurado ? 'inicio' : 'ventas'
        );
        setEstaLogueado(true);
        obtenerProductos();
        obtenerClientes();
      } catch {
        console.error('No se pudo restaurar la sesión.');
      } finally {
        setRestaurandoSesion(false); // pase lo que pase, se apaga la pantalla de carga
      }
    };
    restaurarSesion();
    
  }, []);

  // Inicia sesión con el email y la contraseña recibidos (lo usan el formulario y los botones demo)
  const iniciarSesion = async (emailIngresado: string, passwordIngresada: string) => {
    setMensaje('');
    setCargando(true);

    try {
      const respuesta = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailIngresado, password: passwordIngresada }),
      });
      const datos = await respuesta.json();

      if (respuesta.ok) {
        localStorage.setItem('token', datos.token);
        setNombreUsuario(datos.usuario.nombre);
        setRolUsuario(datos.usuario.rol);
        cambiarVista(datos.usuario.rol === 'admin' ? 'inicio' : 'ventas');
        setEstaLogueado(true);
        obtenerProductos();
        obtenerClientes();
      } else {
        setMensaje(datos.error);
      }
    } catch (error) {
      console.error(error);
      setMensaje('No se pudo conectar con el servidor. Verificá que esté encendido.');
    } finally {
      setCargando(false);
    }
  };

  // Controlador del formulario de login
  const manejarLogin = (e: React.FormEvent) => {
    e.preventDefault();
    iniciarSesion(email, password);
  };

  const cerrarSesion = () => {
    localStorage.removeItem('token');
    setEstaLogueado(false);
    setRolUsuario('');
    setVistaActual('inicio');
    localStorage.removeItem('vista'); // la próxima sesión arranca en la sección por defecto
    setEmail('');
    setPassword('');
    setMensaje('');
    setMostrarPassword(false);
  };

  const stockBajoCount = productos.filter((p) => p.stock < 20).length;

  // Título y subtítulo de cada sección (se muestran en la barra superior del contenido)
  const infoSeccion: Record<string, { titulo: string; subtitulo: string }> = {
    inicio: {
      titulo: 'Inicio',
      subtitulo: 'Resumen de ventas, deudas y stock del negocio',
    },
    ventas: {
      titulo: 'Punto de Venta',
      subtitulo: 'Facturación rápida, control de stock en vivo y ventas en cuenta corriente',
    },
    productos: {
      titulo: 'Catálogo e Inventario',
      subtitulo: 'Administración de artículos, precios unitarios y existencias',
    },
    clientes: {
      titulo: 'Cartera de Clientes y Cuentas Corrientes',
      subtitulo: 'Control de saldos deudores, historial de movimientos y cobranzas',
    },
    historial: {
      titulo: 'Historial de Ventas',
      subtitulo: 'Facturas emitidas, estado y anulación con devolución de stock',
    },
    usuarios: {
      titulo: 'Control de Accesos',
      subtitulo: 'Gestión de operadores y administradores habilitados en el sistema',
    },
  };

  const inicialesUsuario = nombreUsuario
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Opciones del MENÚ LATERAL. El vendedor solo ve las que no son "soloAdmin" (Ventas / Caja).
  const opcionesMenu = [
    {
      clave: 'inicio',
      texto: 'Inicio',
      soloAdmin: true,
      icono: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
    },
    {
      clave: 'ventas',
      texto: 'Ventas / Caja',
      soloAdmin: false,
      icono: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    },
    {
      clave: 'productos',
      texto: 'Productos y Stock',
      soloAdmin: true,
      icono: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
    },
    {
      clave: 'clientes',
      texto: 'Clientes y Cuentas',
      soloAdmin: true,
      icono: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    },
    {
      clave: 'historial',
      texto: 'Historial de Ventas',
      soloAdmin: true,
      icono: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    },
    {
      clave: 'usuarios',
      texto: 'Usuarios',
      soloAdmin: true,
      icono: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    },
  ];

  // PANTALLA DE CARGA: se muestra mientras se verifica el token guardado
  if (restaurandoSesion) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-10 w-10 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm font-bold text-slate-500">Cargando...</p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDERIZADO CONDICIONAL: PANEL PRINCIPAL (MENÚ LATERAL + CONTENIDO)
  // --------------------------------------------------------------------------
  if (estaLogueado) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row">
        {/* MENÚ LATERAL: lo comparten todas las pantallas */}
        <aside className="md:w-64 shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-col md:sticky md:top-0 md:h-screen">
          <div className="px-5 py-5 flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-600/25 shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight text-slate-800 leading-none">Gestión Pro</h1>
              <p className="text-[11px] text-slate-400 font-medium mt-0.5">Gestión comercial</p>
            </div>
          </div>

          <nav className="flex md:flex-col gap-1 px-3 pb-3 md:pb-0 overflow-x-auto md:overflow-visible">
            {opcionesMenu
              .filter((op) => esAdmin || !op.soloAdmin)
              .map((op) => (
                <button
                  key={op.clave}
                  onClick={() => cambiarVista(op.clave)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm transition-all shrink-0 text-left ${
                    vistaActual === op.clave
                      ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-600/30'
                      : 'text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={op.icono} />
                  </svg>
                  <span>{op.texto}</span>
                  {op.clave === 'productos' && stockBajoCount > 0 && (
                    <span
                      className={`ml-auto text-xs font-black px-1.5 rounded-full ${
                        vistaActual === 'productos'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {stockBajoCount}
                    </span>
                  )}
                </button>
              ))}
          </nav>
        </aside>

        {/* CONTENIDO: barra superior con el usuario + la pantalla elegida */}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-black text-slate-800 truncate">
                {infoSeccion[vistaActual]?.titulo}
              </h2>
              <p className="text-xs text-slate-500 truncate">{infoSeccion[vistaActual]?.subtitulo}</p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="hidden sm:flex items-center gap-2.5 pr-3 border-r border-slate-200">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
                  {inicialesUsuario || 'OP'}
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-bold text-slate-800">{nombreUsuario}</p>
                  <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    {esAdmin ? 'Administrador' : 'Vendedor'}
                  </p>
                </div>
              </div>

              <button
                onClick={cerrarSesion}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-red-600 bg-slate-100 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-3 py-2 rounded-lg transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Salir</span>
              </button>
            </div>
          </header>

          <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-8">
            {esAdmin && vistaActual === 'inicio' && (
              <VistaInicio nombre={nombreUsuario} irA={cambiarVista} />
            )}

            {vistaActual === 'ventas' && (
              <VistaVentas
                productos={productos}
                clientes={clientes}
                recargarProductos={obtenerProductos}
                recargarClientes={obtenerClientes}
              />
            )}

            {esAdmin && vistaActual === 'productos' && (
              <VistaProductos
                productos={productos}
                recargarProductos={obtenerProductos}
                cargando={cargandoProductos}
                error={errorProductos}
              />
            )}

            {esAdmin && vistaActual === 'clientes' && (
              <VistaClientes
                clientes={clientes}
                recargarClientes={obtenerClientes}
                cargando={cargandoClientes}
                error={errorClientes}
              />
            )}

            {esAdmin && vistaActual === 'historial' && (
              <VistaHistorial recargarProductos={obtenerProductos} recargarClientes={obtenerClientes} />
            )}

            {esAdmin && vistaActual === 'usuarios' && <VistaUsuarios />}
          </main>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // PANTALLA DE LOGIN (Cuando estaLogueado es false)
  // --------------------------------------------------------------------------
  return (
    <div
      className="h-screen w-full overflow-hidden bg-cover bg-bottom lg:bg-[length:100%_100%] bg-no-repeat flex items-center justify-center p-4"
      style={{ backgroundImage: "url('/fondoo-login.png')" }}
    >
      <div className="bg-white/95 backdrop-blur-xs p-8 sm:p-10 rounded-2xl shadow-[0_20px_50px_rgba(37,99,235,0.18)] w-full max-w-md border border-blue-100">
        <div className="mb-8 text-center">
          <div className="mx-auto w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/30 mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">
            Bienvenido al Sistema
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Gestión Comercial, Stock y Cuentas Corrientes
          </p>
        </div>

        <form onSubmit={manejarLogin} className="flex flex-col gap-5">
          <div>
            <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">
              Correo Electrónico
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 pointer-events-none">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
                placeholder="admin@ventas.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">
              Contraseña
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 pointer-events-none">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </span>
              <input
                type={mostrarPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-11 pr-12 py-3 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setMostrarPassword(!mostrarPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                title={mostrarPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
              >
                {mostrarPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={cargando}
            className={`w-full font-bold py-3 px-4 rounded-lg text-white shadow-lg transition-all mt-1 flex items-center justify-center gap-2 ${
              cargando
                ? 'bg-blue-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 hover:shadow-blue-600/30 active:scale-[0.99]'
            }`}
          >
            {cargando ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span>Verificando acceso...</span>
              </>
            ) : (
              <span>Ingresar al Sistema</span>
            )}
          </button>
        </form>

        {mensaje && (
          <div className="mt-5 p-3.5 bg-red-50 border border-red-200 border-l-4 border-l-red-600 text-red-700 text-sm rounded-r-lg flex items-center gap-2.5">
            <svg className="w-5 h-5 text-red-600 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{mensaje}</span>
          </div>
        )}

        {/* ACCESO RÁPIDO DE DEMOSTRACIÓN */}
        <div className="mt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-slate-200"></div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Acceso demo
            </span>
            <div className="flex-1 h-px bg-slate-200"></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={cargando}
              onClick={() => iniciarSesion(DEMO_ADMIN.email, DEMO_ADMIN.password)}
              className="py-2.5 px-3 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed transition shadow-xs"
            >
              Demo Administrador
            </button>
            <button
              type="button"
              disabled={cargando}
              onClick={() => iniciarSesion(DEMO_VENDEDOR.email, DEMO_VENDEDOR.password)}
              className="py-2.5 px-3 rounded-lg text-sm font-bold text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 disabled:opacity-60 disabled:cursor-not-allowed transition shadow-xs"
            >
              Demo Vendedor
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-8 pt-4 border-t border-slate-100">
          Acceso exclusivo para operadores y administradores
        </p>
      </div>
    </div>
  );
}

export default App;