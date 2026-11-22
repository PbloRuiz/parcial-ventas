import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

//Creacion de tablas
//USUARIOS
export const usuarios = sqliteTable("usuarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // Hash de bcrypt
  rol: text("rol").notNull().default("operador"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
});

//CLIENTES
export const clientes = sqliteTable("clientes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  razonSocial: text("razon_social").notNull(),
  documento: text("documento").notNull().unique(),
  contacto: text("contacto"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  limiteCredito: real("limite_credito").notNull().default(0),
});

//PRODUCTOS Y STOCK
export const productos = sqliteTable("productos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  precio: real("precio").notNull(),
  stock: integer("stock").notNull().default(0),
 //--
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
});

export const movimientosStock = sqliteTable("movimientos_stock", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productoId: integer("producto_id").notNull().references(() => productos.id),
  cantidad: integer("cantidad").notNull(),
  motivo: text("motivo").notNull(),
  fecha: text("fecha").notNull(),
});

//VENTAS
export const ventas = sqliteTable("ventas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  numeroComprobante: text("numero_comprobante").notNull().unique(),
  fecha: text("fecha").notNull(),
  clienteId: integer("cliente_id").references(() => clientes.id),
  total: real("total").notNull(),
  formaPago: text("forma_pago").notNull(),
  anulada: integer("anulada", { mode: "boolean" }).default(false),
});

export const detallesVenta = sqliteTable("detalles_venta", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ventaId: integer("venta_id").notNull().references(() => ventas.id),
  productoId: integer("producto_id").notNull().references(() => productos.id),
  cantidad: integer("cantidad").notNull(),
  precioUnitario: real("precio_unitario").notNull(),
  nombreProducto: text("nombre_producto").notNull(),
  subtotal: real("subtotal").notNull(),
});

//CUENTAS CORRIENTES
export const movimientosCtaCte = sqliteTable("movimientos_cta_cte", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clienteId: integer("cliente_id").notNull().references(() => clientes.id),
  fecha: text("fecha").notNull(),
  tipo: text("tipo").notNull(), // "cargo" o "abono"
  importe: real("importe").notNull(),
  observacion: text("observacion"),
  ventaId: integer("venta_id").references(() => ventas.id),
});
