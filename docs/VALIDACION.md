# Verificación y decisiones

Fecha: 04/10/2026, America/Caracas.

## Ejemplo real suministrado

El ZIP se inspeccionó únicamente en lectura y mediante el parser local. No se copió al proyecto, no se procesó a través de la aplicación y no se introdujeron sus correos en staging ni en el histórico.

| Comprobación | Resultado |
|---|---:|
| Tamaño ZIP | 56.008.089 bytes |
| Entradas totales | 49 |
| EML detectados y parseados | 48 |
| Errores del parser | 0 |
| Cuerpos de texto extraídos | 48 |
| Message-ID | 48 |
| In-Reply-To no vacío decodificado | 34 |
| Adjuntos (solo metadata) | 131 |
| EML más grande | 26.217.840 bytes |
| Remitente Geraldine | 7 |
| Remitente Rubén | 6 |
| Remitente Lyliana | 11 |
| Remitente Yessika | 0 |

La clasificación conservadora del fragmento, considerado aisladamente, produjo 10 solicitudes, 4 correos iniciados, 1 respuesta enlazada con suficiente evidencia y 33 casos para revisión. Este conteo **no representa la atención de un día completo**: faltan originales y otras partes de las conversaciones. No se inventaron relaciones para elevar la cantidad de respuestas. La inspección estructural vio 38 cabeceras In-Reply-To presentes; 34 tenían identificadores no vacíos interpretables por el parser.

Se observaron multipart/alternative, multipart/related, multipart/mixed, text/plain, text/html, quoted-printable y base64, con imágenes, PDF y archivos de oficina. El diseño conserva el texto completo y descarta únicamente los bytes de adjuntos después del parseo individual. El estado Zoho se trata como diagnóstico, no como evidencia de lectura o atención.

No se adjuntó un HTML de referencia; el reporte se implementó siguiendo las secciones descritas en la solicitud.

## Pruebas

| Verificación | Resultado |
|---|---|
| `npm test` | 38 pruebas aprobadas, 4 archivos |
| `npm run lint` | Sin errores ni advertencias |
| `npm run typecheck` | Correcto |
| `npm run build` | Build de producción correcto |
| Navegador Chrome, build de producción | Flujo completo correcto |
| ZIP sintético mayor de 500 MB | 501 EML procesados sin publicar |

Las pruebas unitarias e integración usan correos sintéticos y PostgreSQL WASM, sin mocks de las transacciones de negocio. La suite de navegador inicia una base independiente y sirve el build de producción para verificar el Worker real, staging, aprobación, acceso privado, reportes y diseño móvil. Sus capturas y archivos se guardan en `test-results/` y no se publican.

El acceso se actualizó a una clave compartida privada (`APP_PASSWORD`), sin correo ni creación manual de usuarios. Se prueban la inicialización de la identidad técnica, el rechazo de claves incorrectas, el bloqueo y recuperación de intentos, y la invalidación de sesiones al rotar la clave o el secreto. La clave de producción no se incluye en código, pruebas ni documentación.

Prueba grande completada: **525.614.714 bytes de ZIP**, 501 EML sintéticos procesados mediante el Worker real; 501 registros permanecieron en staging sin aprobación. La petición más grande fue de **63.325 bytes**. Pasaron login/logout, protección de páginas/API, cambio de estado solo después de aprobar, recarga del histórico, descarga HTML, respaldo, rechazo de origen incorrecto y diseño móvil de 390 px sin desbordamiento de página.

## Límites explícitos

- Un ZIP completo nunca se convierte a ArrayBuffer ni se envía al servidor; lectura por rangos, un EML y un lote en memoria.
- Un EML individual de más de 64 MiB se registra como error. El parser MIME usa buffers adicionales al tamaño de la entrada. No se promete que todos los EML posibles funcionen en todos los móviles.
- Texto completo de más de los límites de validación/petición se rechaza, sin truncarlo.
- Los casos sin originales fiables requieren revisión manual; un fragmento de día no permite reconstrucción perfecta.
- Un ZIP por importación, múltiples importaciones acumulativas.
- Las identidades del equipo se capturan al importar. Cambiar configuración no reatribuye el histórico.
- La restauración web y la reconstrucción total de metadata están sujetas a recursos y tiempos del alojamiento; para millones de mensajes se requiere reconciliación incremental y respaldo nativo PostgreSQL.
- Las credenciales de la base y el despliegue Vercel se configuran fuera del repositorio.
- La auditoría de dependencias de producción no detectó vulnerabilidades. La cadena de herramientas de desarrollo conserva avisos transitivos de `braces` (ESLint) y `esbuild` (Drizzle Kit). La corrección automática propuesta retrocede a versiones incompatibles; no se aplicó ese downgrade. Estas herramientas no se ejecutan como servicios expuestos de producción.
