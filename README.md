# 🚆 Transporte Vivo

Un mapa interactivo y en tiempo real del transporte público de toda España, con horarios.

**Ábrelo aquí:** https://yourfree343-tech.github.io/transporte-vivo/

## Qué hace
- Muestra trenes, metros y autobuses moviéndose en directo sobre el mapa.
- Al tocar un vehículo ves su línea, su destino, todas sus paradas con la hora prevista y su retraso real.
- Al tocar una estación ves sus próximas salidas. Un punto verde indica que ese tren está ahora en el mapa.
- Puedes buscar estaciones, líneas o números de tren: pulsa `/` para empezar a buscar.
- Puedes activar o desactivar cada operador, cambiar entre modo claro y oscuro, y seguir un vehículo en el mapa.

## Operadores
| Operador | Posición en directo | Horarios | Retrasos |
|---|---|---|---|
| Renfe Cercanías / Rodalies (todos los núcleos) | ✔ | ✔ | ✔ |
| Renfe AV / Larga y Media Distancia | ✔ | ✔ | ✔ |
| Metro Bilbao, Bilbobus, dBus Donostia | ✔ | Los que publica Euskadi | — |
| Resto del País Vasco (se detecta solo cada día) | ✔ | ✔ | — |
| EMT Málaga, EMT Fuenlabrada, ArroyoBus | ✔ | — | — |

Para añadir otro operador, edita `feeds.base.json`. El campo `gtfs` es opcional y sirve para traer sus horarios.

## Cómo funciona
- La web es estática y se aloja en GitHub Pages. El navegador lee directamente los feeds GTFS-Realtime de cada operador, en JSON o protobuf. Si un operador no permite el acceso desde el navegador (CORS), la web pasa por el proxy público corsproxy.io.
- Cada noche, la tarea `.github/workflows/pages.yml` ejecuta `tools/build_data.py`. Este programa descarga los horarios oficiales (GTFS) de cada operador, se queda solo con los viajes del día y los guarda en `data/` en pequeños fragmentos JSON.
- Si añades `#demo` al final de la dirección, verás vehículos simulados.

Los datos son de Renfe, del Gobierno Vasco (Open Data Euskadi), del CTB y del resto de operadores, todos con licencia abierta. El mapa es © OpenStreetMap y © CARTO.
