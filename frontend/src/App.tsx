import { useState, useEffect } from 'react';

// CONFIGURACIÓN DE CONEXIÓN AL BACKEND:
// Si la app está subida a Vercel, lee la variable de entorno VITE_API_URL.
// Si estás trabajando en tu computadora, usa automáticamente http://localhost:3000.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';


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
      const respuesta = await fetch(`${API_URL}/api/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: clienteId ? Number(clienteId) : null,
          formaPago,
          carrito,
          total: totalVenta,
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
          total: totalVenta,
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
}: {
  productos: Producto[];
  recargarProductos: () => void;
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
      const respuesta = await fetch(url, {
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
}: {
  clientes: Cliente[];
  recargarClientes: () => void;
}) => {
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [razonSocial, setRazonSocial] = useState('');
  const [documento, setDocumento] = useState('');
  const [contacto, setContacto] = useState('');

  const [clienteDetalle, setClienteDetalle] = useState<Cliente | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoCtaCte[]>([]);
  const [importePago, setImportePago] = useState('');
  const [observacionPago, setObservacionPago] = useState('');

  const manejarGuardarCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const respuesta = await fetch(`${API_URL}/api/clientes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razonSocial, documento, contacto }),
      });

      if (respuesta.ok) {
        alert('Cliente registrado exitosamente.');
        setMostrarFormulario(false);
        setRazonSocial('');
        setDocumento('');
        setContacto('');
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
      const resp = await fetch(`${API_URL}/api/clientes/${cli.id}/movimientos`);
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
      const resp = await fetch(`${API_URL}/api/clientes/${clienteDetalle.id}/pagos`, {
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
        const respMovs = await fetch(`${API_URL}/api/clientes/${clienteDetalle.id}/movimientos`);
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
          <form onSubmit={manejarGuardarCliente} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            <div className="sm:col-span-3 flex justify-end mt-2">
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
              <th className="p-3.5 text-right">Saldo Deudor</th>
              <th className="p-3.5 text-center">Cuenta Corriente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clientes.map((cli) => (
              <tr key={cli.id} className="hover:bg-slate-50">
                <td className="p-3.5 font-semibold text-slate-800">{cli.razonSocial}</td>
                <td className="p-3.5 text-slate-600">{cli.documento}</td>
                <td className="p-3.5 text-slate-600">{cli.contacto || '-'}</td>
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


// VISTA 4: PANTALLA DE USUARIOS DEL SISTEMA
const VistaUsuarios = () => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('vendedor');

  useEffect(() => {
    const obtenerUsuarios = async () => {
      try {
        const respuesta = await fetch(`${API_URL}/api/usuarios`);
        const datos = await respuesta.json();
        setUsuarios(datos);
      } catch {
        console.error('Error al obtener usuarios');
      }
    };
    obtenerUsuarios();
  }, []);

  const manejarGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const respuesta = await fetch(`${API_URL}/api/usuarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, password, rol }),
      });

      if (respuesta.ok) {
        alert('Usuario registrado exitosamente.');
        setMostrarFormulario(false);
        setNombre('');
        setEmail('');
        setPassword('');
        setRol('vendedor');

        const resp = await fetch(`${API_URL}/api/usuarios`);
        const datos = await resp.json();
        setUsuarios(datos);
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
          onClick={() => setMostrarFormulario(!mostrarFormulario)}
          className={`${
            mostrarFormulario ? 'bg-slate-500 hover:bg-slate-600' : 'bg-blue-600 hover:bg-blue-700'
          } text-white px-4 py-2 rounded-lg text-sm font-bold shadow-xs transition`}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo Usuario'}
        </button>
      </div>

      {mostrarFormulario && (
        <div className="bg-white p-6 rounded-xl shadow-sm mb-6 border-t-4 border-blue-600">
          <h3 className="text-lg font-bold mb-4 text-slate-800">Registrar Nuevo Acceso</h3>
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
              <label className="block text-xs font-bold text-slate-700 mb-1">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
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
                className="bg-blue-600 text-white font-bold text-sm py-2.5 px-8 rounded-lg hover:bg-blue-700 transition shadow-xs"
              >
                Guardar Usuario
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
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
              </tr>
            ))}
          </tbody>
        </table>
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
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);

  const [vistaActual, setVistaActual] = useState('productos');

  const obtenerProductos = async () => {
    try {
      const respuesta = await fetch(`${API_URL}/api/productos`);
      const datos = await respuesta.json();
      setProductos(datos);
    } catch (error) {
      console.error('Error al cargar productos:', error);
    }
  };

  const obtenerClientes = async () => {
    try {
      const respuesta = await fetch(`${API_URL}/api/clientes`);
      const datos = await respuesta.json();
      setClientes(datos);
    } catch (error) {
      console.error('Error al cargar clientes:', error);
    }
  };

  const manejarLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje('');
    setCargando(true);

    try {
      const respuesta = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const datos = await respuesta.json();

      if (respuesta.ok) {
        localStorage.setItem('token', datos.token);
        setNombreUsuario(datos.usuario.nombre);
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

  const cerrarSesion = () => {
    localStorage.removeItem('token');
    setEstaLogueado(false);
    setEmail('');
    setPassword('');
    setMensaje('');
    setMostrarPassword(false);
  };

  const stockBajoCount = productos.filter((p) => p.stock < 20).length;
  const totalPorCobrar = clientes.reduce((acc, c) => acc + c.saldo, 0);
  const clientesConDeuda = clientes.filter((c) => c.saldo > 0).length;

  const infoSeccion: Record<string, { titulo: string; subtitulo: string }> = {
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

  // --------------------------------------------------------------------------
  // RENDERIZADO CONDICIONAL: PANEL PRINCIPAL (TOP NAVBAR + HERO BANNER)
  // --------------------------------------------------------------------------
  if (estaLogueado) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col">
        {/* BARRA DE NAVEGACIÓN SUPERIOR */}
        <nav className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-600/25">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <div>
                <h1 className="text-base font-black tracking-tight text-slate-800 leading-none">
                  Gestión Pro
                </h1>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Panel Comercial</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              <button
                onClick={() => setVistaActual('ventas')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm transition-all shrink-0 ${
                  vistaActual === 'ventas'
                    ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-600/30'
                    : 'text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>Ventas / Caja</span>
              </button>

              <button
                onClick={() => setVistaActual('productos')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm transition-all shrink-0 ${
                  vistaActual === 'productos'
                    ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-600/30'
                    : 'text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <span>Productos y Stock</span>
                {stockBajoCount > 0 && (
                  <span
                    className={`text-xs font-black px-1.5 py-0.2 rounded-full ${
                      vistaActual === 'productos'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {stockBajoCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setVistaActual('clientes')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm transition-all shrink-0 ${
                  vistaActual === 'clientes'
                    ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-600/30'
                    : 'text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Clientes y Cuentas</span>
              </button>

              <button
                onClick={() => setVistaActual('usuarios')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm transition-all shrink-0 ${
                  vistaActual === 'usuarios'
                    ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-600/30'
                    : 'text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>Usuarios</span>
              </button>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="hidden md:flex items-center gap-2.5 pr-3 border-r border-slate-200">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
                  {inicialesUsuario || 'OP'}
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-bold text-slate-800">{nombreUsuario}</p>
                  <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    En línea
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
                <span>Cerrar Sesión</span>
              </button>
            </div>
          </div>
        </nav>

        {/* ENCABEZADO AZUL DEGRADADO (HERO BANNER) */}
        <header className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 text-white pt-8 pb-20 px-4 sm:px-8">
          <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
                {infoSeccion[vistaActual]?.titulo}
              </h2>
              <p className="text-sm text-blue-200 mt-1">
                {infoSeccion[vistaActual]?.subtitulo}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-blue-100 bg-white/10 border border-white/15 px-3.5 py-2 rounded-lg backdrop-blur-xs capitalize">
                {new Date().toLocaleDateString('es-AR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </span>

              {vistaActual !== 'ventas' && (
                <button
                  onClick={() => setVistaActual('ventas')}
                  className="bg-white text-blue-900 hover:bg-blue-50 text-xs font-black px-4 py-2 rounded-lg shadow-md transition"
                >
                  + Nueva Venta
                </button>
              )}
            </div>
          </div>
        </header>

        {/* CONTENIDO PRINCIPAL CON TARJETAS KPI FLOTANTES */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 -mt-12 pb-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
            <div className="bg-white p-5 rounded-xl shadow-md shadow-slate-900/5 border border-slate-200/80 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Artículos en Catálogo
                </p>
                <p className="text-2xl font-black text-slate-800 mt-1">
                  {productos.length} <span className="text-sm font-medium text-slate-500">prod.</span>
                </p>
                <p className={`text-xs mt-1 font-semibold ${stockBajoCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {stockBajoCount > 0
                    ? `${stockBajoCount} con stock bajo (< 20 un.)`
                    : 'Niveles de stock óptimos'}
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-md shadow-slate-900/5 border border-slate-200/80 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Clientes Registrados
                </p>
                <p className="text-2xl font-black text-slate-800 mt-1">
                  {clientes.length} <span className="text-sm font-medium text-slate-500">activos</span>
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {clientesConDeuda === 0
                    ? 'Sin saldos pendientes'
                    : `${clientesConDeuda} con cuenta corriente activa`}
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-md shadow-slate-900/5 border border-slate-200/80 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Total a Cobrar (Cta. Cte.)
                </p>
                <p className={`text-2xl font-black mt-1 ${totalPorCobrar > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  ${totalPorCobrar.toLocaleString('es-AR')}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Saldo consolidado de clientes
                </p>
              </div>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${totalPorCobrar > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          {vistaActual === 'ventas' && (
            <VistaVentas
              productos={productos}
              clientes={clientes}
              recargarProductos={obtenerProductos}
              recargarClientes={obtenerClientes}
            />
          )}

          {vistaActual === 'productos' && (
            <VistaProductos productos={productos} recargarProductos={obtenerProductos} />
          )}

          {vistaActual === 'clientes' && (
            <VistaClientes clientes={clientes} recargarClientes={obtenerClientes} />
          )}

          {vistaActual === 'usuarios' && <VistaUsuarios />}
        </main>
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

        <p className="text-center text-xs text-slate-400 mt-8 pt-4 border-t border-slate-100">
          Acceso exclusivo para operadores y administradores
        </p>
      </div>
    </div>
  );
}

export default App;