import { useState, useEffect } from 'react';

// 1. DEFINICIÓN DE TIPOS (TypeScript)
// Le explicamos a React qué forma exacta tiene un "Producto" que viene de la base de datos.
interface Producto {
  id: number;
  codigo: string;
  nombre: string;
  precio: number;
  stock: number;
}
// Molde para cada línea del ticket de venta
interface ItemCarrito {
  idProducto: number;
  codigo: string;
  nombre: string;
  precio: number;
  cantidad: number;
  subtotal: number;
}

// --- COMPONENTES AISLADOS (FUERA DE APP) ---
// Al sacarlos de la función principal "App", evitamos el error de ESLint "Cannot create components during render"
// y mejoramos el rendimiento porque React ya no los destruye y vuelve a crear en cada clic.

// Vista 1: Pantalla de Ventas (Ahora con lógica de Punto de Venta)
const VistaVentas = ({ productos, recargarProductos }: { productos: Producto[], recargarProductos:() => void }) => {
  // Estados del carrito y formulario de venta
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [productoSeleccionado, setProductoSeleccionado] = useState('');
  const [cantidad, setCantidad] = useState<number>(1);
  const [cliente, setCliente] = useState('Consumidor Final'); // Por defecto
  const [formaPago, setFormaPago] = useState('contado');

  // Función para meter productos al ticket
  const agregarAlCarrito = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productoSeleccionado) return alert('Por favor, seleccioná un producto.');
    if (cantidad < 1) return alert('La cantidad debe ser mayor a 0.');

    // Buscamos toda la info del producto elegido
    const prod = productos.find(p => p.id === parseInt(productoSeleccionado));
    if (!prod) return;

    // VALIDACIÓN DE STOCK SEGÚN ENUNCIADO: No podemos vender lo que no tenemos
   if (cantidad > prod.stock) {
      return alert(`Stock insuficiente. Solo quedan ${prod.stock} unidades de ${prod.nombre}.`);
    }

    // Armamos el renglón del ticket
    const nuevoItem: ItemCarrito = {
      idProducto: prod.id,
      codigo: prod.codigo,
      nombre: prod.nombre,
      precio: prod.precio,
      cantidad: cantidad,
      subtotal: prod.precio * cantidad
    };

    // Guardamos en el carrito y limpiamos los inputs
    setCarrito([...carrito, nuevoItem]);
    setProductoSeleccionado('');
    setCantidad(1);
  };

  // Función para sacar un producto si nos equivocamos
  const quitarDelCarrito = (index: number) => {
    const nuevoCarrito = carrito.filter((_, i) => i !== index);
    setCarrito(nuevoCarrito);
  };

  // Calculamos el total sumando los subtotales
  const totalVenta = carrito.reduce((total, item) => total + item.subtotal, 0);

  // NUEVO: Función para enviar el ticket al servidor Express
  const manejarConfirmarVenta = async () => {
    try {
      const respuesta = await fetch('http://localhost:3000/api/ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente: cliente,
          formaPago: formaPago,
          carrito: carrito,
          total: totalVenta
        })
      });

      const datos = await respuesta.json();

      if (respuesta.ok) {
        alert('Venta registrada con éxito. El stock ha sido descontado.');
        setCarrito([]); // Vaciamos el carrito
        setCliente('Consumidor Final'); // Reseteamos el cliente
        recargarProductos(); // Le pedimos a App que vuelva a buscar los datos actualizados a SQLite
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
      
      {/* PANEL IZQUIERDO: Formulario para armar la venta */}
      <div className="w-1/3 bg-white p-6 rounded-lg shadow h-fit">
        <h2 className="text-xl font-bold mb-4 text-gray-800">Nueva Venta</h2>
        
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-1">Cliente</label>
          <input 
            type="text" 
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="Nombre o 'Consumidor Final'"
          />
        </div>

        <form onSubmit={agregarAlCarrito} className="mb-4 bg-gray-50 p-4 rounded border">
          <label className="block text-sm font-bold text-gray-700 mb-1">Producto</label>
          <select 
            value={productoSeleccionado}
            onChange={(e) => setProductoSeleccionado(e.target.value)}
            className="w-full p-2 border rounded mb-3 outline-none"
          >
            <option value="">-- Seleccionar --</option>
            {/* Filtramos para no mostrar productos inactivos o sin stock */}
            {productos.filter(p => p.stock > 0).map(prod => (
              <option key={prod.id} value={prod.id}>
                {prod.nombre} (${prod.precio})
              </option>
            ))}
          </select>

          <label className="block text-sm font-bold text-gray-700 mb-1">Cantidad</label>
          <input 
            type="number" 
            min="1"
            value={cantidad}
            onChange={(e) => setCantidad(parseInt(e.target.value))}
            className="w-full p-2 border rounded mb-4 outline-none"
          />

          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition">
            Agregar al Detalle
          </button>
        </form>

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

      {/* PANEL DERECHO: El ticket / Detalle de la venta */}
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
                      <button onClick={() => quitarDelCarrito(index)} className="text-red-500 hover:text-red-700 font-bold">
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-between items-end">
          <div>
            <p className="text-gray-600">Cliente: <span className="font-bold text-gray-800">{cliente}</span></p>
            <p className="text-gray-600">Pago: <span className="font-bold text-gray-800 uppercase">{formaPago.replace('_', ' ')}</span></p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Total a cobrar</p>
            <p className="text-4xl font-black text-green-600">${totalVenta}</p>

            <button 
              className={`mt-4 px-8 py-3 rounded font-bold text-white shadow-lg transition ${carrito.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
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

// Vista 2: Pantalla de Productos
// Ahora recibe la función recargarProductos para actualizar la tabla apenas guardamos uno nuevo
const VistaProductos = ({ productos, recargarProductos }: { productos: Producto[], recargarProductos: () => void }) => {
  // Estado para mostrar u ocultar el formulario
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  
  // Estados para los campos del nuevo producto
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [stock, setStock] = useState('');

  // Función para enviar el nuevo producto al backend
  const manejarGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const respuesta = await fetch('http://localhost:3000/api/productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: codigo,
          nombre: nombre,
          precio: Number(precio),
          stock: Number(stock)
        })
      });

      if (respuesta.ok) {
        alert('Producto registrado exitosamente.');
        setMostrarFormulario(false);
        // Limpiamos los campos del formulario
        setCodigo('');
        setNombre('');
        setPrecio('');
        setStock('');
        // Le pedimos al componente principal que recargue la lista desde SQLite
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
      {/* Encabezado con título y botón de agregar dinámico */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Productos y Stock</h2>
        <button 
          onClick={() => setMostrarFormulario(!mostrarFormulario)}
          className={`${mostrarFormulario ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-600 hover:bg-green-700'} text-white px-4 py-2 rounded font-semibold shadow transition`}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo Producto'}
        </button>
      </div>

      {/* FORMULARIO DE ALTA (Se muestra solo si mostrarFormulario es true) */}
      {mostrarFormulario && (
        <div className="bg-white p-6 rounded-lg shadow mb-6 border-t-4 border-green-600">
          <h3 className="text-lg font-bold mb-4 text-gray-800">Registrar Nuevo Producto</h3>
          <form onSubmit={manejarGuardar} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Código</label>
              <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-green-500" required placeholder="Ej. AG-2027" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Nombre del Producto</label>
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-green-500" required placeholder="Ej. Agenda Diaria" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Precio Unitario ($)</label>
              <input type="number" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-green-500" required />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Stock Inicial</label>
              <input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-green-500" required />
            </div>
            <div className="col-span-2 flex justify-end mt-4">
              <button type="submit" className="bg-green-600 text-white font-bold py-2 px-8 rounded hover:bg-green-700 transition shadow">
                Guardar Producto
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TABLA DE INVENTARIO */}
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
                  <span className={prod.stock < 20 ? "text-red-600 font-bold bg-red-100 px-2 py-1 rounded" : "text-green-600 font-bold bg-green-100 px-2 py-1 rounded"}>
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

// Vista 3: Pantalla de Clientes
const VistaClientes = () => (
  <div>
    <h2 className="text-2xl font-bold mb-4 text-gray-800">Clientes y Cuentas Corrientes</h2>
    <p className="text-gray-600">Aquí gestionaremos las deudas y pagos de los clientes registrados.</p>
  </div>
);

interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: string;
}

const VistaUsuarios = () => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  
  // Estados para el formulario
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('vendedor');

  // Traemos los usuarios al cargar el componente cumpliendo con las reglas de efectos
  useEffect(() => {
    const obtenerUsuarios = async () => {
      try {
        const respuesta = await fetch('http://localhost:3000/api/usuarios');
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
      const respuesta = await fetch('http://localhost:3000/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, password, rol })
      });

      if (respuesta.ok) {
        alert('Usuario registrado exitosamente.');
        setMostrarFormulario(false);
        setNombre(''); setEmail(''); setPassword(''); setRol('vendedor');
        
        // Recargamos la tabla
        const resp = await fetch('http://localhost:3000/api/usuarios');
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
          className={`${mostrarFormulario ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white px-4 py-2 rounded font-semibold shadow transition`}
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
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Contraseña</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Rol</label>
              <select value={rol} onChange={(e) => setRol(e.target.value)} className="w-full p-2 border rounded outline-none focus:ring-2 focus:ring-blue-500">
                <option value="vendedor">Vendedor</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div className="col-span-2 flex justify-end mt-4">
              <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-8 rounded hover:bg-blue-700 transition shadow">
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
                  <span className={`px-2 py-1 rounded text-sm font-bold ${user.rol === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
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

// --- COMPONENTE PRINCIPAL ---
function App() {
  // Estados para el Login (Lo que el usuario escribe)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mensaje, setMensaje] = useState('');
  
  // Estados para el Panel de Control
  const [estaLogueado, setEstaLogueado] = useState(false);    // Define si mostramos el login o el sistema
  const [nombreUsuario, setNombreUsuario] = useState('');     // Guarda el nombre del operador actual
  const [productos, setProductos] = useState<Producto[]>([]); // Guarda los datos que llegan de SQLite
  
  // Estado para la Navegación (Menú lateral)
  const [vistaActual, setVistaActual] = useState('productos'); // Por defecto arranca en la tabla de productos

  // Función para enviar las credenciales al backend (Express)
  const manejarLogin = async (e: React.FormEvent) => {
    e.preventDefault(); // Evita que se recargue la página entera al mandar el formulario
    
    try {
      const respuesta = await fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const datos = await respuesta.json();

      if (respuesta.ok) {
        // Si todo sale bien, guardamos el token en el navegador
        localStorage.setItem('token', datos.token);
        setNombreUsuario(datos.usuario.nombre); 
        setEstaLogueado(true);  // Ocultamos el login y mostramos el sistema
        obtenerProductos();     // Automáticamente pedimos la lista de mercadería
      } else {
        // Si la clave está mal, mostramos el error que nos devolvió el servidor
        setMensaje(datos.error);
      }
    } catch (error) {
      console.error(error);
      setMensaje('Error al conectar con el servidor.');
    }
  };

  // Función para traer el inventario desde el backend
  const obtenerProductos = async () => {
    try {
      const respuesta = await fetch('http://localhost:3000/api/productos');
      const datos = await respuesta.json();
      setProductos(datos); // Actualizamos el estado con la data real de SQLite
    } catch (error) {
      console.error("Error al cargar productos:", error);
    }
  };

  // Función para cerrar la sesión y resetear todo a cero
  const cerrarSesion = () => {
    localStorage.removeItem('token'); // Borramos el token de seguridad
    setEstaLogueado(false);           // Volvemos a mostrar la pantalla de Login
    setEmail('');
    setPassword('');
    setMensaje('');
  };

  // --------------------------------------------------------
  // RENDERIZADO CONDICIONAL: ¿Qué le mostramos al usuario?
  // --------------------------------------------------------

  // SI EL USUARIO YA PASÓ EL LOGIN: Mostramos el Layout del Sistema
  if (estaLogueado) {
    return (
      <div className="min-h-screen bg-gray-100 flex">
        
        {/* SIDEBAR / MENÚ LATERAL */}
        <aside className="w-64 bg-gray-900 text-white flex flex-col shadow-xl">
          <div className="p-6 border-b border-gray-700">
            <h1 className="text-xl font-black tracking-wider uppercase text-blue-400">Sistema Ventas</h1>
            <p className="text-sm text-gray-400 mt-1">Operador: {nombreUsuario}</p>
          </div>
          
          {/* Botones de navegación. Cada uno cambia el estado de "vistaActual" para alternar las pantallas */}
          <nav className="flex-1 p-4 flex flex-col gap-2">
            <button 
              onClick={() => setVistaActual('ventas')}
              className={`text-left px-4 py-3 rounded transition-colors ${vistaActual === 'ventas' ? 'bg-blue-600 font-bold' : 'hover:bg-gray-800'}`}
            >
              Ventas
            </button>
            <button 
              onClick={() => setVistaActual('productos')}
              className={`text-left px-4 py-3 rounded transition-colors ${vistaActual === 'productos' ? 'bg-blue-600 font-bold' : 'hover:bg-gray-800'}`}
            >
              Productos y Stock
            </button>
            <button 
              onClick={() => setVistaActual('clientes')}
              className={`text-left px-4 py-3 rounded transition-colors ${vistaActual === 'clientes' ? 'bg-blue-600 font-bold' : 'hover:bg-gray-800'}`}
            >
              Clientes y Cuentas
            </button>
            <button 
              onClick={() => setVistaActual('usuarios')}
              className={`text-left px-4 py-3 rounded transition-colors ${vistaActual === 'usuarios' ? 'bg-blue-600 font-bold' : 'hover:bg-gray-800'}`}
            >
              Usuarios
            </button>
          </nav>

          {/* Botón para salir */}
          <div className="p-4 border-t border-gray-700">
            <button 
              onClick={cerrarSesion}
              className="w-full bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white px-4 py-2 rounded transition-colors"
            >
              Cerrar Sesión
            </button>
          </div>
        </aside>

        {/* ÁREA DE CONTENIDO PRINCIPAL */}
        <main className="flex-1 p-8 overflow-y-auto">
          {vistaActual === 'ventas' && <VistaVentas productos={productos} recargarProductos={obtenerProductos} />}
          
          {/* A VistaProductos le pasamos el inventario y la función para actualizarlo tras un alta */}
          {vistaActual === 'productos' && <VistaProductos productos={productos} recargarProductos={obtenerProductos} />}
          
          {vistaActual === 'clientes' && <VistaClientes />}
          {vistaActual === 'usuarios' && <VistaUsuarios />}
        </main>
      </div>
    );
  }

  // SI NO ESTÁ LOGUEADO: Mostramos el formulario original de Login
  return (
    <div className="min-h-screen bg-gray-200 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-xl w-96 border-t-4 border-blue-600">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black text-gray-800">Ingreso</h1>
          <p className="text-gray-500 text-sm mt-2">Sistema de Gestión Comercial</p>
        </div>
        
        {/* Formulario conectado a la función manejarLogin */}
        <form onSubmit={manejarLogin} className="flex flex-col gap-5">
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">Correo Electrónico</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder="admin@ventas.com"
              required
            />
          </div>
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">Contraseña</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder="clave"
              required
            />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded hover:bg-blue-700 hover:shadow-lg transition-all mt-2">
            Ingresar al Sistema
          </button>
        </form>
        
        {/* Si hay un error, mostramos el cartel rojo */}
        {mensaje && (
          <div className="mt-6 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-medium">
            {mensaje}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;