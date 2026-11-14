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



// VISTA 1: PANTALLA DE VENTAS (Punto de Venta)
// Recibe los productos y clientes desde App, y las funciones para avisarle
// a App que vuelva a consultar SQLite cuando se concrete una venta.

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

  // Función que valida y agrega un renglón al ticket de venta (todavía en memoria, sin guardar en BD)
  const agregarAlCarrito = (e: React.FormEvent) => {
    e.preventDefault(); // Evita que el formulario recargue toda la página
    if (!productoSeleccionado) return alert('Por favor, seleccioná un producto.');
    if (cantidad < 1) return alert('La cantidad debe ser mayor a 0.');

    // Buscamos el objeto completo del producto elegido en el listado
    const prod = productos.find((p) => p.id === parseInt(productoSeleccionado));
    if (!prod) return;

    // VALIDACIÓN DE STOCK: No permitimos vender más unidades de las que hay disponibles
    if (cantidad > prod.stock) {
      return alert(`Stock insuficiente. Solo quedan ${prod.stock} unidades de ${prod.nombre}.`);
    }

    // Armamos el nuevo renglón del ticket calculando su subtotal
    const nuevoItem: ItemCarrito = {
      idProducto: prod.id,
      codigo: prod.codigo,
      nombre: prod.nombre,
      precio: prod.precio,
      cantidad: cantidad,
      subtotal: prod.precio * cantidad,
    };

    // Agregamos el ítem al arreglo del carrito sin borrar los anteriores (...carrito) y limpiamos inputs
    setCarrito([...carrito, nuevoItem]);
    setProductoSeleccionado('');
    setCantidad(1);
  };

  // Elimina un renglón del ticket filtrando todos los elementos excepto el de la posición "index"
  const quitarDelCarrito = (index: number) => {
    setCarrito(carrito.filter((_, i) => i !== index));
  };

  // Recorre todo el carrito y suma los subtotales para obtener el total general del comprobante
  const totalVenta = carrito.reduce((total, item) => total + item.subtotal, 0);

  // Busca el nombre del cliente seleccionado para mostrarlo en el resumen del ticket
  const clienteActualNombre = clienteId
    ? clientes.find((c) => c.id === Number(clienteId))?.razonSocial || 'Cliente seleccionado'
    : 'Consumidor Final';

  // Envía la venta definitiva al servidor Express para descontar stock, guardar factura y cargar deuda si es fiado
  const manejarConfirmarVenta = async () => {
    // Regla de negocio: no se puede fiar a un "Consumidor Final" anónimo
    if (formaPago === 'cuenta_corriente' && !clienteId) {
      return alert('Para vender en Cuenta Corriente debés seleccionar un cliente registrado.');
    }

    try {
      const respuesta = await fetch(`${API_URL}/api/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: clienteId ? Number(clienteId) : null, // Si está vacío, mandamos null
          formaPago,
          carrito,
          total: totalVenta,
        }),
      });

      const datos = await respuesta.json();

      if (respuesta.ok) {
        alert(`Venta registrada con éxito (${datos.comprobante}). Stock actualizado.`);
        // Limpiamos la pantalla para dejarla lista para el próximo cliente
        setCarrito([]);
        setClienteId('');
        setFormaPago('contado');
        // Le avisamos al componente principal App que refresque productos (nuevo stock) y clientes (nuevo saldo)
        recargarProductos();
        recargarClientes();
      } else {
        alert(`Error: ${datos.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('Error de conexión con el servidor.');
    }
  };

  return (
    <div className="flex gap-6">
      {/* PANEL IZQUIERDO: Formulario para seleccionar cliente, productos y forma de pago */}
      <div className="w-1/3 bg-white p-6 rounded-lg shadow h-fit">
        <h2 className="text-xl font-bold mb-4 text-gray-800">Nueva Venta</h2>

        {/* Selector de Cliente (Consumidor Final o clientes cargados en SQLite) */}
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-1">Cliente</label>
          <select
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none"
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
        <form onSubmit={agregarAlCarrito} className="mb-4 bg-gray-50 p-4 rounded border">
          <label className="block text-sm font-bold text-gray-700 mb-1">Producto</label>
          <select
            value={productoSeleccionado}
            onChange={(e) => setProductoSeleccionado(e.target.value)}
            className="w-full p-2 border rounded mb-3 outline-none"
          >
            <option value="">-- Seleccionar --</option>
            {/* Filtramos para mostrar únicamente mercadería que tenga stock mayor a 0 */}
            {productos
              .filter((p) => p.stock > 0)
              .map((prod) => (
                <option key={prod.id} value={prod.id}>
                  {prod.nombre} (${prod.precio}) - Stock: {prod.stock}
                </option>
              ))}
          </select>

          <label className="block text-sm font-bold text-gray-700 mb-1">Cantidad</label>
          <input
            type="number"
            min="1"
            value={cantidad}
            onChange={(e) => setCantidad(parseInt(e.target.value) || 1)}
            className="w-full p-2 border rounded mb-4 outline-none"
          />

          <button
            type="submit"
            className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition"
          >
            Agregar al Detalle
          </button>
        </form>

        {/* Selector de Medio de Pago */}
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-1">Forma de Pago</label>
          <select
            value={formaPago}
            onChange={(e) => setFormaPago(e.target.value)}
            className="w-full p-2 border rounded outline-none"
          >
            <option value="contado">Contado / Efectivo</option>
            <option value="tarjeta">Tarjeta (Débito/Crédito)</option>
            <option value="cuenta_corriente">Cuenta Corriente</option>
          </select>
        </div>
      </div>

      {/* PANEL DERECHO: Vista previa del comprobante / ticket */}
      <div className="w-2/3 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4 text-gray-800">Detalle del Comprobante</h2>

        <div className="min-h-[250px] border rounded bg-gray-50 p-4 mb-4">
          {carrito.length === 0 ? (
            <p className="text-gray-400 text-center mt-20">No hay productos en la venta actual.</p>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="pb-2">Producto</th>
                  <th className="pb-2 text-center">Cant.</th>
                  <th className="pb-2 text-right">Subtotal</th>
                  <th className="pb-2 text-center">Acción</th>
                </tr>
              </thead>
              <tbody>
                {carrito.map((item, index) => (
                  <tr key={index} className="border-b border-gray-200">
                    <td className="py-3">{item.nombre}</td>
                    <td className="py-3 text-center">{item.cantidad}</td>
                    <td className="py-3 text-right font-medium">${item.subtotal}</td>
                    <td className="py-3 text-center">
                      <button
                        onClick={() => quitarDelCarrito(index)}
                        className="text-red-500 hover:text-red-700 font-bold"
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

        {/* Pie del ticket con resumen y botón de confirmación */}
        <div className="flex justify-between items-end">
          <div>
            <p className="text-gray-600">
              Cliente: <span className="font-bold text-gray-800">{clienteActualNombre}</span>
            </p>
            <p className="text-gray-600">
              Pago:{' '}
              <span className="font-bold text-gray-800 uppercase">
                {formaPago.replace('_', ' ')}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Total a cobrar</p>
            <p className="text-4xl font-black text-green-600">${totalVenta}</p>

            <button
              className={`mt-4 px-8 py-3 rounded font-bold text-white shadow-lg transition ${
                carrito.length === 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
              disabled={carrito.length === 0}
              onClick={manejarConfirmarVenta}
            >
              Confirmar Venta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


// VISTA 2: PANTALLA DE PRODUCTOS Y STOCK
// Permite listar la mercadería y dar de alta nuevos artículos en SQLite.

const VistaProductos = ({
  productos,
  recargarProductos,
}: {
  productos: Producto[];
  recargarProductos: () => void;
}) => {
  // Controla si el formulario de alta está desplegado u oculto
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  // Estados de los campos del formulario
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [stock, setStock] = useState('');

  // Envía el nuevo producto al backend (POST /api/productos)
  const manejarGuardar = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const respuesta = await fetch(`${API_URL}/api/productos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo,
          nombre,
          precio: Number(precio), // Convertimos el texto del input a número
          stock: Number(stock),
        }),
      });

      if (respuesta.ok) {
        alert('Producto registrado exitosamente.');
        setMostrarFormulario(false);
        setCodigo('');
        setNombre('');
        setPrecio('');
        setStock('');
        recargarProductos(); // Actualiza la tabla inmediatamente
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
      {/* Encabezado y botón dinámico para abrir/cerrar el formulario */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Productos y Stock</h2>
        <button
          onClick={() => setMostrarFormulario(!mostrarFormulario)}
          className={`${
            mostrarFormulario ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-600 hover:bg-green-700'
          } text-white px-4 py-2 rounded font-semibold shadow transition`}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo Producto'}
        </button>
      </div>

      {/* Formulario condicional de alta de producto */}
      {mostrarFormulario && (
        <div className="bg-white p-6 rounded-lg shadow mb-6 border-t-4 border-green-600">
          <h3 className="text-lg font-bold mb-4 text-gray-800">Registrar Nuevo Producto</h3>
          <form onSubmit={manejarGuardar} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Código</label>
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-green-500"
                required
                placeholder="Ej. AG-2027"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Nombre del Producto
              </label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-green-500"
                required
                placeholder="Ej. Agenda Diaria"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Precio Unitario ($)
              </label>
              <input
                type="number"
                min="0"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Stock Inicial</label>
              <input
                type="number"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>
            <div className="col-span-2 flex justify-end mt-4">
              <button
                type="submit"
                className="bg-green-600 text-white font-bold py-2 px-8 rounded hover:bg-green-700 transition shadow"
              >
                Guardar Producto
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabla principal de inventario */}
      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th className="p-3 border-b">Código</th>
              <th className="p-3 border-b">Producto</th>
              <th className="p-3 border-b">Precio</th>
              <th className="p-3 border-b">Stock</th>
            </tr>
          </thead>
          <tbody>
            {productos.map((prod) => (
              <tr key={prod.id} className="hover:bg-gray-50 border-b">
                <td className="p-3 font-medium text-gray-700">{prod.codigo}</td>
                <td className="p-3">{prod.nombre}</td>
                <td className="p-3">${prod.precio}</td>
                <td className="p-3">
                  {/* Alerta visual en rojo si quedan menos de 20 unidades */}
                  <span
                    className={
                      prod.stock < 20
                        ? 'text-red-600 font-bold bg-red-100 px-2 py-1 rounded'
                        : 'text-green-600 font-bold bg-green-100 px-2 py-1 rounded'
                    }
                  >
                    {prod.stock} un.
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


// VISTA 3: PANTALLA DE CLIENTES Y CUENTAS CORRIENTES
// Gestiona el alta de clientes, consulta de saldos deudores, historial de
// movimientos (cargos y abonos) y recepción de pagos en caja.

const VistaClientes = ({
  clientes,
  recargarClientes,
}: {
  clientes: Cliente[];
  recargarClientes: () => void;
}) => {
  // Estados para el formulario de alta de cliente nuevo
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [razonSocial, setRazonSocial] = useState('');
  const [documento, setDocumento] = useState('');
  const [contacto, setContacto] = useState('');

  // Estados para el panel inferior de Cuenta Corriente:
  // Si "clienteDetalle" es null, el panel está cerrado. Si tiene un cliente, se abre abajo.
  const [clienteDetalle, setClienteDetalle] = useState<Cliente | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoCtaCte[]>([]);
  const [importePago, setImportePago] = useState('');
  const [observacionPago, setObservacionPago] = useState('');

  // Guarda un cliente nuevo en SQLite
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
        recargarClientes(); // Refresca la tabla de clientes
      } else {
        const datos = await respuesta.json();
        alert(`Error: ${datos.error}`);
      }
    } catch {
      alert('Error de conexión con el servidor.');
    }
  };

  // Abre el estado de cuenta de un cliente y trae su historial de movimientos desde el backend
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

  // Registra un pago (abono) para descontar deuda de la cuenta corriente del cliente abierto
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
        // 1. Actualizamos la tabla general de clientes (arriba)
        recargarClientes();
        // 2. Volvemos a pedir los movimientos de este cliente para actualizar el historial (abajo)
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

  // Calcula en tiempo real el saldo del cliente abierto: suma los "cargos" (deudas) y resta los "abonos" (pagos)
  const saldoActualDetalle = movimientos.reduce(
    (acc, m) => (m.tipo === 'cargo' ? acc + m.importe : acc - m.importe),
    0
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Clientes y Cuentas Corrientes</h2>
        <button
          onClick={() => setMostrarFormulario(!mostrarFormulario)}
          className={`${
            mostrarFormulario ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'
          } text-white px-4 py-2 rounded font-semibold shadow transition`}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo Cliente'}
        </button>
      </div>

      {/* FORMULARIO ALTA DE CLIENTE */}
      {mostrarFormulario && (
        <div className="bg-white p-6 rounded-lg shadow mb-6 border-t-4 border-blue-600">
          <h3 className="text-lg font-bold mb-4 text-gray-800">Registrar Nuevo Cliente</h3>
          <form onSubmit={manejarGuardarCliente} className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Razón Social / Nombre
              </label>
              <input
                type="text"
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500"
                required
                placeholder="Ej. Librería San Martín"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">CUIT / DNI</label>
              <input
                type="text"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500"
                required
                placeholder="Ej. 20-35123456-7"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Contacto / Tel.</label>
              <input
                type="text"
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ej. 381-5551234"
              />
            </div>
            <div className="col-span-3 flex justify-end mt-2">
              <button
                type="submit"
                className="bg-blue-600 text-white font-bold py-2 px-8 rounded hover:bg-blue-700 transition shadow"
              >
                Guardar Cliente
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TABLA GENERAL DE CLIENTES Y SUS SALDOS */}
      <div className="overflow-x-auto bg-white rounded-lg shadow mb-8">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th className="p-3 border-b">Razón Social</th>
              <th className="p-3 border-b">CUIT / DNI</th>
              <th className="p-3 border-b">Contacto</th>
              <th className="p-3 border-b text-right">Saldo Deudor</th>
              <th className="p-3 border-b text-center">Cuenta Corriente</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((cli) => (
              <tr key={cli.id} className="hover:bg-gray-50 border-b">
                <td className="p-3 font-medium text-gray-800">{cli.razonSocial}</td>
                <td className="p-3 text-gray-600">{cli.documento}</td>
                <td className="p-3 text-gray-600">{cli.contacto || '-'}</td>
                <td className="p-3 text-right">
                  {/* Rojo si tiene deuda pendiente (> 0), verde si está al día */}
                  <span
                    className={
                      cli.saldo > 0
                        ? 'text-red-600 font-bold bg-red-100 px-2 py-1 rounded'
                        : 'text-green-600 font-bold bg-green-100 px-2 py-1 rounded'
                    }
                  >
                    ${cli.saldo}
                  </span>
                </td>
                <td className="p-3 text-center">
                  <button
                    onClick={() => abrirDetalleCuenta(cli)}
                    className="bg-indigo-600 text-white text-sm px-3 py-1 rounded hover:bg-indigo-700 transition font-semibold"
                  >
                    Ver Movimientos / Pagar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* PANEL INFERIOR: DETALLE DE MOVIMIENTOS Y COBRO (Solo se muestra al elegir un cliente) */}
      {clienteDetalle && (
        <div className="bg-white p-6 rounded-lg shadow border-t-4 border-indigo-600">
          <div className="flex justify-between items-center mb-4 pb-3 border-b">
            <div>
              <h3 className="text-xl font-bold text-gray-800">
                Estado de Cuenta: {clienteDetalle.razonSocial}
              </h3>
              <p className="text-sm text-gray-500">Documento: {clienteDetalle.documento}</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase font-bold">Saldo Actual</p>
                <p
                  className={`text-2xl font-black ${
                    saldoActualDetalle > 0 ? 'text-red-600' : 'text-green-600'
                  }`}
                >
                  ${saldoActualDetalle}
                </p>
              </div>
              {/* Botón X para cerrar el panel de detalle */}
              <button
                onClick={() => setClienteDetalle(null)}
                className="text-gray-400 hover:text-gray-700 font-bold text-lg px-2"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Formulario rápido para ingresar un pago/entrega del cliente */}
          <form
            onSubmit={manejarRegistrarPago}
            className="flex gap-4 items-end bg-gray-50 p-4 rounded border mb-6"
          >
            <div className="w-1/4">
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Importe a Abonar ($)
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={importePago}
                onChange={(e) => setImportePago(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-indigo-500"
                required
                placeholder="0.00"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-bold text-gray-700 mb-1">Observación</label>
              <input
                type="text"
                value={observacionPago}
                onChange={(e) => setObservacionPago(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Ej. Pago parcial efectivo / Transferencia"
              />
            </div>
            <button
              type="submit"
              className="bg-green-600 text-white font-bold py-2 px-6 rounded hover:bg-green-700 transition shadow"
            >
              Registrar Pago
            </button>
          </form>

          {/* Tabla cronológica de deudas (cargos) y pagos (abonos) */}
          <h4 className="font-bold text-gray-700 mb-2">Historial de Movimientos</h4>
          {movimientos.length === 0 ? (
            <p className="text-gray-400 text-sm py-4">
              Este cliente aún no registra movimientos en cuenta corriente.
            </p>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100 border-b">
                  <th className="p-2">Fecha</th>
                  <th className="p-2">Tipo</th>
                  <th className="p-2">Concepto</th>
                  <th className="p-2 text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((mov) => (
                  <tr key={mov.id} className="border-b">
                    <td className="p-2 text-gray-600">
                      {new Date(mov.fecha).toLocaleDateString('es-AR')}
                    </td>
                    <td className="p-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                          mov.tipo === 'cargo'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {mov.tipo === 'cargo' ? 'Cargo (Deuda)' : 'Abono (Pago)'}
                      </span>
                    </td>
                    <td className="p-2">{mov.observacion || '-'}</td>
                    <td
                      className={`p-2 text-right font-bold ${
                        mov.tipo === 'cargo' ? 'text-red-600' : 'text-green-600'
                      }`}
                    >
                      {mov.tipo === 'cargo' ? '+' : '-'}${mov.importe}
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
// Permite visualizar los operadores/administradores y crear nuevas cuentas.

const VistaUsuarios = () => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('vendedor');

  // useEffect con arreglo vacío [] se ejecuta una sola vez cuando se abre esta pestaña
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

        // Recargamos la lista actualizada desde SQLite
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
        <h2 className="text-2xl font-bold text-gray-800">Gestión de Usuarios</h2>
        <button
          onClick={() => setMostrarFormulario(!mostrarFormulario)}
          className={`${
            mostrarFormulario ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'
          } text-white px-4 py-2 rounded font-semibold shadow transition`}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo Usuario'}
        </button>
      </div>

      {mostrarFormulario && (
        <div className="bg-white p-6 rounded-lg shadow mb-6 border-t-4 border-blue-600">
          <h3 className="text-lg font-bold mb-4 text-gray-800">Registrar Nuevo Acceso</h3>
          <form onSubmit={manejarGuardar} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Nombre Completo</label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Rol</label>
              <select
                value={rol}
                onChange={(e) => setRol(e.target.value)}
                className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="vendedor">Vendedor</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div className="col-span-2 flex justify-end mt-4">
              <button
                type="submit"
                className="bg-blue-600 text-white font-bold py-2 px-8 rounded hover:bg-blue-700 transition shadow"
              >
                Guardar Usuario
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th className="p-3 border-b">Nombre</th>
              <th className="p-3 border-b">Email</th>
              <th className="p-3 border-b">Rol</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50 border-b">
                <td className="p-3 font-medium text-gray-700">{user.nombre}</td>
                <td className="p-3">{user.email}</td>
                <td className="p-3">
                  <span
                    className={`px-2 py-1 rounded text-sm font-bold ${
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
  // Estados del formulario de Login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false); // Controla el ojo de ver/ocultar clave
  const [cargando, setCargando] = useState(false); // Muestra animación mientras responde el servidor

  // Estados globales de sesión y datos maestros compartidos entre vistas
  const [estaLogueado, setEstaLogueado] = useState(false);
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);

  // Controla qué pantalla se muestra en el área principal ('ventas', 'productos', 'clientes', 'usuarios')
  const [vistaActual, setVistaActual] = useState('productos');

  // Consulta la lista actualizada de productos al servidor Express
  const obtenerProductos = async () => {
    try {
      const respuesta = await fetch(`${API_URL}/api/productos`);
      const datos = await respuesta.json();
      setProductos(datos);
    } catch (error) {
      console.error('Error al cargar productos:', error);
    }
  };

  // Consulta la lista actualizada de clientes con sus saldos de cuenta corriente
  const obtenerClientes = async () => {
    try {
      const respuesta = await fetch(`${API_URL}/api/clientes`);
      const datos = await respuesta.json();
      setClientes(datos);
    } catch (error) {
      console.error('Error al cargar clientes:', error);
    }
  };

  // Valida credenciales contra /api/login, guarda el token JWT y carga los datos iniciales
  const manejarLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje('');
    setCargando(true); // Activamos el estado de carga en el botón

    try {
      const respuesta = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const datos = await respuesta.json();

      if (respuesta.ok) {
        localStorage.setItem('token', datos.token); // Guarda el pase de seguridad en el navegador
        setNombreUsuario(datos.usuario.nombre);
        setEstaLogueado(true);
        // Al ingresar, traemos productos y clientes para tenerlos listos en todas las pantallas
        obtenerProductos();
        obtenerClientes();
      } else {
        setMensaje(datos.error);
      }
    } catch (error) {
      console.error(error);
      setMensaje('No se pudo conectar con el servidor. Verificá que esté encendido.');
    } finally {
      setCargando(false); // Desactivamos el estado de carga pase lo que pase
    }
  };

  // Borra el token y vuelve a la pantalla de inicio de sesión
  const cerrarSesion = () => {
    localStorage.removeItem('token');
    setEstaLogueado(false);
    setEmail('');
    setPassword('');
    setMensaje('');
    setMostrarPassword(false);
  };

  // --------------------------------------------------------------------------
  // RENDERIZADO CONDICIONAL:
  // Si el usuario inició sesión -> Muestra el panel con menú lateral y vistas.
  // Si NO inició sesión -> Muestra la pantalla de Login.
  // --------------------------------------------------------------------------
  if (estaLogueado) {
    return (
      <div className="min-h-screen bg-gray-100 flex">
        {/* SIDEBAR / MENÚ LATERAL DE NAVEGACIÓN */}
        <aside className="w-64 bg-gray-900 text-white flex flex-col shadow-xl">
          <div className="p-6 border-b border-gray-700">
            <h1 className="text-xl font-black tracking-wider uppercase text-blue-400">
              Sistema Ventas
            </h1>
            <p className="text-sm text-gray-400 mt-1">Operador: {nombreUsuario}</p>
          </div>

          <nav className="flex-1 p-4 flex flex-col gap-2">
            <button
              onClick={() => setVistaActual('ventas')}
              className={`text-left px-4 py-3 rounded transition-colors ${
                vistaActual === 'ventas' ? 'bg-blue-600 font-bold' : 'hover:bg-gray-800'
              }`}
            >
              Ventas
            </button>
            <button
              onClick={() => setVistaActual('productos')}
              className={`text-left px-4 py-3 rounded transition-colors ${
                vistaActual === 'productos' ? 'bg-blue-600 font-bold' : 'hover:bg-gray-800'
              }`}
            >
              Productos y Stock
            </button>
            <button
              onClick={() => setVistaActual('clientes')}
              className={`text-left px-4 py-3 rounded transition-colors ${
                vistaActual === 'clientes' ? 'bg-blue-600 font-bold' : 'hover:bg-gray-800'
              }`}
            >
              Clientes y Cuentas
            </button>
            <button
              onClick={() => setVistaActual('usuarios')}
              className={`text-left px-4 py-3 rounded transition-colors ${
                vistaActual === 'usuarios' ? 'bg-blue-600 font-bold' : 'hover:bg-gray-800'
              }`}
            >
              Usuarios
            </button>
          </nav>

          <div className="p-4 border-t border-gray-700">
            <button
              onClick={cerrarSesion}
              className="w-full bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white px-4 py-2 rounded transition-colors"
            >
              Cerrar Sesión
            </button>
          </div>
        </aside>

        {/* ÁREA DE CONTENIDO PRINCIPAL (Renderiza la vista seleccionada en el menú) */}
        <main className="flex-1 p-8 overflow-y-auto">
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

     // PANTALLA DE LOGIN MEJORADA (Cuando estaLogueado es false)
  return (
    <div
      className="h-screen w-full overflow-hidden bg-cover bg-bottom lg:bg-[length:100%_100%] bg-no-repeat flex items-center justify-center p-4"
      style={{ backgroundImage: "url('/fondoo-login.png')" }}
    >
      <div className="bg-white/95 backdrop-blur-xs p-8 sm:p-10 rounded-2xl shadow-[0_20px_50px_rgba(37,99,235,0.18)] w-full max-w-md border border-blue-100">

        {/* Cabecera con ícono de marca y título */}
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

        {/* Formulario conectado a la función manejarLogin */}
        <form onSubmit={manejarLogin} className="flex flex-col gap-5">
          {/* Campo Correo Electrónico con ícono */}
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

          {/* Campo Contraseña con candado y botón de mostrar/ocultar */}
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

          {/* Botón de envío con spinner de carga */}
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

        {/* Cartel rojo de alerta si falla el usuario o contraseña */}
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

        {/* Pie informativo */}
        <p className="text-center text-xs text-slate-400 mt-8 pt-4 border-t border-slate-100">
          Acceso exclusivo para operadores y administradores
        </p>
      </div>
    </div>
  );
}

export default App;