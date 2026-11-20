# 🚆 Transporte Vivo

Un mapa interactivo y en tiempo real del transporte público de toda España, con horarios.

**Ábrelo aquí:** https://yourfree343-tech.github.io/transporte-vivo/

## Qué hace
- Muestra trenes, metros y autobuses moviéndose en directo sobre el mapa.
- Al tocar un vehículo ves su línea, su destino, todas sus paradas con la hora prevista y su retraso real.
- Al tocar una estación ves sus próximas salidas. Un punto verde indica que ese tren está ahora en el mapa.
- Puedes buscar estaciones, líneas o números de tren: pulsa `/` para empezar a buscar.
- Puedes activar o desactivar cada operador, cambiar entre modo claro y oscuro, y seguir un vehículo en el mapa.

## Novedades
- **Se instala como app** en el móvil (Android: botón "Instalar"; iPhone: Compartir → Añadir a pantalla de inicio).
- **Estaciones favoritas** ⭐ con sus próximas salidas en la pantalla de inicio.
- **Líneas dibujadas** en el mapa con sus colores; la del vehículo elegido se resalta.
- **Avisos de Renfe** en directo, también dentro de la ficha de cada tren o estación.
- **Cómo llegar**: trenes directos entre dos estaciones, con hora de salida, llegada y retraso.
- **FGC** y **Renfe AV/LD/MD** en directo.

## Operadores
| Operador | Posición en directo | Horarios | Retrasos |
|---|---|---|---|
| Renfe Cercanías / Rodalies (todos los núcleos) | ✔ | ✔ | ✔ |
| Renfe AV / Larga y Media Distancia | ✔ | ✔ | ✔ |
| FGC (Ferrocarrils de la Generalitat) | ✔ (si su web lo publica) | ✔ (si su web lo publica) | — |
| Metro Bilbao, Bilbobus, dBus Donostia | ✔ | Los que publica Euskadi | — |
| Resto del País Vasco (se detecta solo cada día) | ✔ | ✔ | — |
| EMT Málaga, EMT Fuenlabrada, ArroyoBus | ✔ | — | — |

Para añadir otro operador, edita `feeds.base.json`. El campo `gtfs` es opcional y sirve para traer sus horarios.

## Cómo funciona
- La web es estática y se aloja en GitHub Pages. El navegador lee directamente los feeds GTFS-Realtime de cada operador, en JSON o protobuf. Como los operadores no dejan leer sus datos desde otra web (CORS), la web los pide a través de un puente propio en Vercel (`api/proxy.js`, https://transporte-vivo.vercel.app).
- Cada noche, la tarea `.github/workflows/pages.yml` ejecuta `tools/build_data.py`. Este programa descarga los horarios oficiales (GTFS) de cada operador, se queda solo con los viajes del día y los guarda en `data/` en pequeños fragmentos JSON.
- Si añades `#demo` al final de la dirección, verás vehículos simulados.

Los datos son de Renfe, del Gobierno Vasco (Open Data Euskadi), del CTB y del resto de operadores, todos con licencia abierta. El mapa es © OpenStreetMap y © CARTO.
