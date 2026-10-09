# Verificación y decisiones

Fecha de actualización: 08/10/2026, America/Caracas.

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

En la versión inicial del 04/10, la clasificación conservadora del fragmento, considerado aisladamente, produjo 10 solicitudes, 4 correos iniciados, 1 respuesta enlazada con suficiente evidencia y 33 casos para revisión. Este conteo **no representa la atención de un día completo**: faltan originales y otras partes de las conversaciones. No se inventaron relaciones para elevar la cantidad de respuestas. La inspección estructural vio 38 cabeceras In-Reply-To presentes; 34 tenían identificadores no vacíos interpretables por el parser.

Se observaron multipart/alternative, multipart/related, multipart/mixed, text/plain, text/html, quoted-printable y base64, con imágenes, PDF y archivos de oficina. El diseño conserva el texto completo y descarta únicamente los bytes de adjuntos después del parseo individual. El estado Zoho se trata como diagnóstico, no como evidencia de lectura o atención.

No se adjuntó un HTML de referencia; el reporte se implementó siguiendo las secciones descritas en la solicitud.

## Pruebas

| Verificación | Resultado |
|---|---|
| `npm test` | 95 pruebas aprobadas, 4 archivos |
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
- Los casos ambiguos o contradictorios requieren revisión manual. El personal reconocido sin original compatible se propone como correo iniciado; un fragmento de día no permite reconstrucción perfecta.
- Hasta 100 ZIP y 100.000 EML por importación lógica; reanudación con el mismo conjunto de partes.
- Los cambios de equipo reevalúan staging pendiente; no reatribuyen el histórico aprobado. Julia se añade automáticamente sin sobrescribir su configuración si ya existe.
- La restauración web y la reconstrucción total de metadata están sujetas a recursos y tiempos del alojamiento; para millones de mensajes se requiere reconciliación incremental y respaldo nativo PostgreSQL.
- Las credenciales de la base y el despliegue Vercel se configuran fuera del repositorio.
- La auditoría de dependencias de producción no detectó vulnerabilidades. La cadena de herramientas de desarrollo conserva avisos transitivos de `braces` (ESLint) y `esbuild` (Drizzle Kit). La corrección automática propuesta retrocede a versiones incompatibles; no se aplicó ese downgrade. Estas herramientas no se ejecutan como servicios expuestos de producción.

## Actualización del 05/10/2026

Sin cambios de esquema ni migración, sin conexión a Neon para pruebas y sin limpieza de datos reales. Se validaron cinco ejemplos de horario diario con SQL y JavaScript, varias respuestas por solicitud, heurística sin cabeceras, asociación manual verificada, exclusión de sí mismo/otras respuestas, dependencia automática, Julia, limpieza por rango con procedencias compartidas y rechazo de previews obsoletos.

El navegador comprueba dos ZIP con nombres internos idénticos, aprobación de la respuesta con su original, 82 solicitudes con aprobación de páginas y rechazo del resto, apertura del contenido no respondido y limpieza con confirmación explícita en la base temporal de prueba. Se mantienen comprobaciones de autenticación, CSRF, HTML, respaldo y móvil.

Prueba de carga múltiple grande del 05/10: **525.614.736 bytes en dos ZIP**, 501 EML en una sola importación; mayor petición **65.825 bytes**. No se publicaron los correos sintéticos.

## Finalización del 07/10/2026

Se conservaron los cambios locales pendientes. Pasaron 75 pruebas unitarias e integración, lint, typecheck y build de producción. El E2E de Chrome pasó con autenticación, dos ZIP, aprobación parcial, pendientes fuera del horario, ignorar/restaurar, edición histórica, auditoría, respuesta sin asociación, reportes, respaldo, CSRF y móvil. Los cinco nombres del personal se cubren mediante configuración sintética; no se incluyen EML ni ZIP corporativos. La prueba de ZIP mayor de 500 MB descrita arriba corresponde al 05/10 y no se repitió en esta ronda.

Se verifican el umbral exacto 16:50, permanencia indefinida del pendiente hasta respuesta o corrección, respuesta de otro día solo al aprobar, búsqueda sin límite de siete días para asuntos específicos compatibles, exclusión de ignorados de tasa/tiempo, restauración, respuesta manual sin correo ficticio, respuesta sin asociación y recuperación posterior del original, edición concurrente rechazada y auditoría protegida contra inyección. La reasociación manual elimina una exclusión anterior y audita ambos registros.

No hubo migración de esquema, reset ni eliminación de datos de producción. Los nuevos campos viven en el JSONB de decisiones existente. El acceso compartido conserva su autenticación; su auditoría identifica la cuenta compartida.

## Acreditación manual y gestiones del 08/10/2026

Se verifica la gestión manual con responsable y Sin asignar, unificación por ID y nombre oficial, sustitución por correo real del mismo responsable, respuestas adicionales y crédito manual explícitamente adicional, fechas de envío/acreditación separadas de recepción, fecha recuperada desde auditoría y referencia de incorporación para registros antiguos sin fecha. La suite cubre exclusión/restauración de ignorados, coherencia de totales y porcentaje 51/105 = 48,6 %, así como respaldo de fecha y auditoría. No se crean mensajes de respuesta ficticios ni se migran o borran datos de producción.

Se repitieron las 88 pruebas, lint, typecheck y build satisfactoriamente. El E2E de Chrome pasó sobre ese build y una base temporal: acredita una gestión sin responsable, la asigna al agente y comprueba la tabla de gestiones y su igualdad con el KPI de enviados. También mantiene las verificaciones del flujo completo y móvil. La prueba grande de 500 MB no se repitió en esta ronda.

## Seguimientos acreditados por destinatario

Se agregaron siete casos de integración: prioridad y orden de Para/CC, direcciones repetidas o con mayúsculas, exclusión de agentes inactivos, separación de solicitudes nuevas y seguimientos, conversaciones iniciadas por personal, fechas de actividad, ignorar/restaurar, correcciones explícitas y sustitución de créditos manuales sin duplicación. Las pruebas verifican que los tiempos no se atribuyan a destinatarios y que no se cambie el correo original. El E2E cubre la acreditación visible, el agente asignado, el detalle de conversación, el total del dashboard y el reporte HTML.
