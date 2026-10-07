# Mis Gastos

App de control de gastos personales para iPhone. PWA (Progressive Web App) sin backend: todos los datos se guardan localmente en el dispositivo con IndexedDB.

## Características (v1)

- Dashboard con saldo total y movimientos recientes
- Cuentas ilimitadas: efectivo, débito, crédito (corte/límite de pago), cuentas con rendimiento (cálculo de interés diario/mensual)
- Transacciones (gasto/ingreso/transferencia) con categoría, nota y marca de "pago domiciliado"
- Categorías predeterminadas + personalizadas + subcategorías
- Presupuestos por categoría con alertas al 80% y 100%
- Calendario de pagos (tarjetas de crédito + domiciliados recurrentes)
- Reportes: gasto por categoría del mes + control total de ahorro
- Respaldo manual (exportar/importar JSON)
- Instalable en pantalla de inicio de iPhone

## Instalar en iPhone

1. Abre la URL de GitHub Pages en Safari.
2. Toca el ícono de compartir.
3. Elige "Agregar a pantalla de inicio".

## Desarrollo local

No requiere build ni dependencias. Sirve la carpeta con cualquier servidor estático, por ejemplo:

```
python3 -m http.server 8000
```

y abre `http://localhost:8000`.
