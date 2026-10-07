# Atención · Histórico de correos Zoho

Aplicación privada para construir un histórico acumulativo de atención. Un ZIP se procesa localmente y se guarda en **staging**. Ningún correo nuevo cambia las búsquedas oficiales, conversaciones, métricas o reportes hasta pulsar **Aprobar e incorporar**.

## Stack y arquitectura

- Next.js 16, React 19, TypeScript, App Router y Tailwind CSS 4.
- PostgreSQL externo con Drizzle ORM y `pg`. Se recomienda **Neon**, con conexión agrupada y TLS, por su integración con Vercel y porque permite transacciones PostgreSQL normales sin incorporar otro servicio de autenticación o almacenamiento. Supabase PostgreSQL también es compatible.
- Acceso con **una clave compartida**, configurada solo en el servidor mediante `APP_PASSWORD`. No se pide correo ni se crean usuarios manualmente. Las sesiones usan tokens aleatorios guardados como HMAC en PostgreSQL, cookie HttpOnly/Secure/SameSite, expiración de ocho horas, revocación al cerrar sesión y bloqueo temporal tras cinco intentos fallidos. Cambiar `APP_PASSWORD` o `AUTH_SECRET` invalida las sesiones anteriores. No hay una clave predeterminada en el código.
- ZIP con `@zip.js/zip.js`, `BlobReader` y Web Worker; MIME con PostalMime; HTML convertido a texto con htmlparser2/domutils. No se ejecuta HTML recibido ni se cargan imágenes externas.
- Vitest con PostgreSQL WASM (PGlite) para pruebas transaccionales; Chrome/Playwright y PGlite Socket exclusivamente para pruebas de navegador. **La aplicación de producción siempre utiliza PostgreSQL externo.**

```text
src/app/(protected)/     Dashboard, solicitudes, conversaciones, importación,
                        revisión, historial y configuración
src/app/api/[...path]/   API autenticada y protección de origen
src/components/         Interfaz y controles reutilizables
src/workers/            Procesador ZIP independiente de la interfaz
src/lib/db/             Esquema Drizzle y conexión PostgreSQL
src/lib/auth/           Contraseñas y sesiones
src/lib/email/          MIME, normalización y contenido
src/lib/imports/        Staging, aprobación, rechazo, descarte y reversión
src/lib/matching/       Reconstrucción conservadora de conversaciones
src/lib/metrics/        Consultas oficiales y filtros
src/lib/reports/        HTML autónomo
src/lib/backup/         Exportación y restauración validada
drizzle/                Migraciones SQL versionadas
tests/                  Correos sintéticos y pruebas de integración
scripts/                Migraciones y verificación local
```

## Ejecutar localmente

Requiere Node.js 22.19 o posterior y una base PostgreSQL vacía. No necesita APIs de IA.

```bash
npm install
```

Copia `.env.example` a `.env` y configura:

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL con TLS en producción. En Neon puede usarse la URL pooled. |
| `APP_PASSWORD` | Clave compartida de acceso. Guárdala como variable privada del servidor; nunca como `NEXT_PUBLIC_…` ni en el repositorio. |
| `AUTH_SECRET` | Secreto aleatorio de al menos 32 caracteres. Cambiarlo invalida las sesiones. |
| `APP_URL` | Origen exacto de la aplicación, sin rutas. Local: `http://localhost:3000`. Producción: `https://tu-dominio.vercel.app`. Se comprueba en operaciones de escritura. |

Genera un secreto en tu terminal, guárdalo únicamente en las variables de entorno:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run db:migrate
npm run dev
```

Entra con el valor de `APP_PASSWORD`. La identidad técnica necesaria para guardar sesiones y auditoría se crea automáticamente. **No necesitas registrar un usuario ni ejecutar un comando de creación de usuarios.** Quienes conozcan la clave comparten el mismo acceso al histórico; las aprobaciones se atribuyen a “Acceso compartido”, no a una persona individual.

Abre `http://localhost:3000`. La pantalla de login y la compilación funcionan sin credenciales; las operaciones de datos necesitan PostgreSQL inicializado.

La migración inicial configura `atencionagentes@credicard.com.ve` y cinco miembros: Geraldine Serrano, Rubén Castro, Lyliana Tarazona, Yessika Salcedo y Julia Lanz G (`julia.lanz@credicard.com.ve`). El comando es idempotente y no sobrescribe la configuración existente.

## Desplegar en Vercel

1. Crea una base PostgreSQL en Neon. Conserva la URL de conexión de forma privada.
2. Importa este repositorio en Vercel y selecciona el preset **Next.js**, raíz del repositorio y Node.js 22.
3. En **Settings → Environment Variables**, configura `DATABASE_URL`, `APP_PASSWORD`, `AUTH_SECRET` y `APP_URL`. Guarda `APP_PASSWORD` como variable privada de Production. `APP_URL` debe coincidir con el dominio por el que se accederá; para previews usa su propio origen y una base separada. Después de cambiar variables, realiza un **Redeploy** para aplicarlas.
4. Desde un terminal autorizado, ejecuta `npm run db:migrate` contra esa base. El acceso compartido se inicializa automáticamente al usar el login: no hace falta crear un usuario.
5. Construye con `npm run build`; Vercel detecta el comando automáticamente. No se ejecutan migraciones durante el build para evitar cambios concurrentes o conectar un preview accidentalmente a producción.
6. Despliega y verifica login, importación sintética, revisión y aprobación. La API declara `maxDuration = 300`; comprueba que el plan elegido admita el tiempo necesario para las aprobaciones/restauraciones de tu volumen.

No se han incluido credenciales de Neon ni Vercel ni la clave de acceso. Subir el código a GitHub no configura por sí solo la base ni las variables privadas. El login distingue entre clave incorrecta, variables faltantes, tablas sin inicializar y problemas de conexión, sin exponer valores secretos.

## Base de datos

| Tabla | Responsabilidad |
|---|---|
| `users`, `sessions` | Identidad técnica automática, control de intentos y sesiones revocables. Se mantienen las tablas existentes por compatibilidad; la clave compartida se verifica exclusivamente contra la variable privada del servidor. |
| `agents`, `settings` | Personal y buzón configurables. |
| `imports` | Archivo, tamaño, huella, estado, fechas y usuario de aprobación. |
| `staged_emails` | Mensajes pendientes con contenido, decisión manual y estado de revisión. Únicos por importación y clave. |
| `import_entries` | Resultado por entrada del ZIP; permite reanudar, listar errores y reintentar archivos fallidos. |
| `emails` | Única fuente oficial de correos aprobados. La clave primaria impide contabilizar dos veces el mismo mensaje. |
| `email_imports` | Procedencias múltiples de cada correo. Hace segura la reversión. |
| `conversations` | Índice reconstruible: primera respuesta válida, fecha, duración y cantidad de respuestas. |
| `restore_jobs`, `restore_rows` | Validación persistente y aislada de respaldos antes de confirmar restauración. |

Los participantes, destinatarios, CC, Reply-To y metadatos de adjuntos se conservan como estructuras JSONB dentro del correo; no hay una tabla independiente de participantes. Los timestamps PostgreSQL usan `timestamp with time zone`. La interfaz muestra DD/MM/YYYY y HH:MM en America/Caracas.

## Importación, pausa y recuperación

1. Selecciona o arrastra **uno o varios ZIP por importación** (hasta 100 partes). Todas las partes seleccionadas comparten revisión y se relacionan entre sí al finalizar.
2. El Worker inspecciona los índices, detecta todos los EML y crea una única importación. Lee cada ZIP y cada EML secuencialmente. El progreso muestra cada parte y el total.
3. Procesa una entrada, extrae información y envía lotes pequeños a `/api/imports/{id}/staging-batch`.
4. El servidor valida los datos, recalcula normalización y clave, reconoce al remitente y guarda solo staging. Cada lote es idempotente y transaccional.
5. La pantalla muestra archivo, tamaño, detectados, procesados, porcentaje, etapa, entrada actual y errores. Los conteos por clasificación y cambios propuestos aparecen en revisión, cuando puede considerarse el conjunto de cabeceras.
6. Al terminar, abre **Revisar importación**. No hay aprobación automática.

Estados: `PROCESSING`, `PARTIAL`, `READY_FOR_REVIEW`, `PARTIALLY_APPROVED`, `APPROVED`, `DISCARDED`, `ERROR` y `REVERTED`. `APPROVED` representa revisión completada y puede contener registros rechazados: la interfaz dice “Revisión completada” y muestra los conteos por separado.

Cancelar termina el Worker y marca la importación parcial. Si el navegador se cierra abruptamente, puede quedar en `PROCESSING`: desde pendientes se puede pausar o reanudar. Para reanudar selecciona todos los mismos ZIP; se verifica su huella (tamaño e índice con nombres, tamaños y CRC), se omiten entradas confirmadas y se vuelven a intentar las fallidas. Si una respuesta HTTP se pierde después de confirmar un lote, reintentarlo no duplica registros. Si se vuelve a cargar como importación nueva, también se mantiene la protección de doble conteo al aprobar.

## Memoria: ZIP de 500 MB

El código nunca llama `arrayBuffer()` sobre el ZIP ni lo envía a Vercel. `File` se pasa al Worker como Blob y `BlobReader` solicita rangos del archivo. No se utiliza `ZipReaderStream`, que puede almacenar el ZIP completo al recibir un stream no seekable.

```text
File local → BlobReader (rangos) → una entrada EML → PostalMime
           → texto + cabeceras + metadata → lote → staging → siguiente entrada
```

- Índice del ZIP en memoria: nombres/tamaños/CRC, no los cuerpos; límite de 100.000 EML por importación.
- Una sola entrada EML descomprimida a la vez, máximo **64 MiB**. También se comprueba el tamaño real durante la extracción y el CRC.
- PostalMime procesa esa entrada completa y decodifica sus adjuntos temporalmente. Solo se guardan nombre, MIME y tamaño; los bytes se liberan con el mensaje. Por tanto, el pico depende del **EML más grande**, con sobrecarga de buffers, cadenas y MIME, no únicamente de su tamaño ni de un límite fijo de 64 MB de RAM.
- Lotes de hasta **100 registros o aproximadamente 750 KB**. Un correo de texto excepcionalmente grande puede ir solo, con un límite serializado de **2,8 MB**; la API limita el cuerpo de petición a **3,2 MB**, por debajo del límite habitual de Vercel.
- Se espera la confirmación del lote antes de leer más entradas. No se acumulan miles de cuerpos pendientes en la interfaz.
- Un EML que supere los límites se registra como error y no se recorta. Los demás continúan. Esto debe tenerse en cuenta al exportar mensajes individuales con adjuntos enormes.

La prueba `npm run test:large-zip` genera en disco un ZIP sintético de más de 500 MB, lo procesa con el Worker real y verifica el tamaño de las peticiones y el número de registros en staging. No es una garantía de rendimiento para todos los teléfonos ni una medición de RAM de cada dispositivo; un EML grande puede exigir bastante memoria incluso con ZIP leído por rangos.

Referencias técnicas: [ZipReader y lectura por rangos](https://gildas-lormeau.github.io/zip.js/api/classes/ZipReader.html), [PostalMime](https://github.com/postalsys/postal-mime).

## MIME y contenido

Se extraen Date, From, To, CC, Reply-To, Subject, Message-ID, In-Reply-To, References y X-ZohoMail-Status. PostalMime interpreta multipart/alternative, mixed/related, quoted-printable, base64 y charsets como UTF-8 e ISO-8859-1.

Se prefiere text/plain. Si solo existe HTML, se convierte a texto, eliminando scripts, estilos y elementos activos. No se almacena ni renderiza HTML ejecutable. Se conserva `bodyText` completo; `newContent` y `preview` son derivados y nunca sustituyen el original. La separación de historial citado es conservadora; las firmas no se eliminan si no existe una frontera fiable. La ficha permite desplegar el texto completo.

Message-ID es la identidad principal (hash SHA-256 del identificador). Si falta, se usa una clave estable de remitente, destinatarios ordenados, CC, fecha, asunto y cuerpo. El servidor vuelve a calcular la clave. No se muestran duplicados como métrica principal.

## Asociación de solicitudes y respuestas

La identidad del miembro activo y si el buzón figura en Para/CC se capturan al procesar el mensaje. Cambiar configuración reevalúa automáticamente todos los mensajes pendientes; conserva las atribuciones ya aprobadas. Julia se añade idempotentemente también en instalaciones existentes, sin requerir una migración.

1. Se busca el padre por In-Reply-To.
2. Si no está disponible, se recorre References desde la referencia más cercana.
3. Se resuelve la raíz de la conversación y se valida cronología.
4. Una respuesta válida exige remitente reconocido como personal, una solicitud raíz externa y una fecha posterior.
5. Los correos externos posteriores son seguimientos; los mensajes iniciales del equipo son **correos iniciados**, no respuestas.
6. Sin cabeceras localizables, se busca asunto normalizado, remitente externo compatible en Para/CC (o mismo remitente en seguimientos), buzón y cronología. Se consulta toda la importación (todos sus ZIP) y todo el histórico aprobado en PostgreSQL. Una única raíz específica compatible se asocia automáticamente sin límite arbitrario de siete días; se reconocen variantes como «Solicitud de cambio de plan» y «Respuesta de cambio de plan». Para asuntos genéricos la raíz debe tener como máximo 24 horas; sin asunto nunca se infiere. Varias raíces compatibles o relaciones contradictorias requieren revisión. Si el remitente pertenece al personal activo y no hay candidato razonable, se propone correo iniciado por personal, incluso con Re:/RV: o cabeceras cuyo original falta. No se relaciona por asunto solamente. Las relaciones históricas aprobadas se conservan al incorporar nuevos mensajes.

El caso dudoso conserva remitente, destinatarios, fecha y contenido. Se puede buscar el original y asignar manualmente solicitud, respuesta, correo iniciado o seguimiento. Una decisión manual también debe cumplir las reglas de remitente y fecha. Una respuesta solo admite una solicitud original externa anterior: nunca ella misma ni otra respuesta. La relación se verifica al guardar. Guardarla no publica el correo.

## Aprobación y reversión

Al entrar en revisión o pulsar **Reanalizar importación**, se recalcula staging con el personal actual y el histórico completo, sin volver a cargar los ZIP ni reclasificar aprobados. La revisión permite seleccionar la página, deseleccionar, aprobar seleccionados, aprobar todos los pendientes con confirmación, rechazar seleccionados o descartar. Los grupos muestran solicitudes, respuestas, iniciados, seguimientos y casos por revisar. Las respuestas a solicitudes históricas muestran el estado actual y propuesto, autor, fecha y tiempo desde la solicitud.

La transacción de aprobación obtiene un bloqueo asesor PostgreSQL compartido por las mutaciones, inserta los correos seleccionados, registra sus procedencias, reconstruye relaciones solo con correos oficiales y seleccionados, valida los casos, reconstruye conversaciones y actualiza staging/importación. Cualquier fallo provoca rollback. Si seleccionas una respuesta cuyo original está pendiente en la misma importación, se incluyen automáticamente el original y la cadena necesaria. También puedes aprobar una conversación completa. Los errores identifican asunto, motivo y enlace para resolver. La paginación muestra solo pendientes y se ajusta al aprobar o rechazar; la selección se reinicia.

La primera respuesta válida se elige por fecha, no por orden de carga. Si posteriormente apruebas una respuesta más temprana, el tiempo se corrige. Las siguientes permanecen en la conversación.

Revertir elimina únicamente la procedencia de esa importación. Un correo se elimina solo si no mantiene otra procedencia válida. Se recalculan conversaciones y métricas. Si desaparece una solicitud raíz, sus respuestas conservadas quedan como **Requiere revisión**, sin inventar otra asociación; se pueden consultar desde Historial y vuelven a enlazarse si se incorpora su original. Descartar staging nunca elimina correos ya oficiales.

## Dashboard, búsqueda y conversación

Se muestran solicitudes recibidas, respondidas, no respondidas, respuestas realizadas, tasa y promedio hasta la primera respuesta. Una solicitud con dos respuestas cuenta como una solicitud atendida y dos respuestas realizadas. Se distinguen respuestas por persona y correos iniciados. El detalle de cada solicitud es una línea temporal con todo el texto, cabeceras útiles y metadata de adjuntos.

Los filtros incluyen hoy, ayer, últimos siete días, mes actual, mes anterior, rango y todo el histórico. **La cohorte se define por fecha de recepción de la solicitud**: las respuestas aprobadas posteriores al período siguen contando para esa solicitud. Las respuestas por persona cuentan mensajes de respuesta válidos y también indican solicitudes distintas; nunca incluyen correos iniciados. La búsqueda incluye el cuerpo y las respuestas del hilo.

## Estado de atención y horario operativo

La revisión cuenta solicitudes únicas que quedarían respondidas/no respondidas, separadas de los tipos de mensaje y de los cambios sobre solicitudes históricas. Los casos automáticos están listos para aprobar; el ajuste manual es opcional. Una clasificación manual de solicitud puede marcar **No respondida**, excluyendo las respuestas actualmente asociadas: estas vuelven a revisión, sin crear respuestas ficticias. Respuestas nuevas aprobadas posteriormente pueden cambiar el estado.

Todos los tiempos suman únicamente la ventana **08:00–17:00 America/Caracas, todos los días**, incluidos sábados y domingos, sin feriados. Dashboard, tablas, revisión, conversación y HTML comparten esa regla. Las consultas recalculan el tiempo sobre las fechas originales, por lo que también funciona sobre datos existentes sin actualización destructiva ni migración. El promedio por persona incluye el tiempo de cada respuesta desde su solicitud; el promedio general utiliza solo la primera respuesta por solicitud. Las solicitudes no respondidas permiten abrir todo su contenido y origen desde su propia tabla.

## Edición histórica, ignorados y pendientes fuera de horario

Cada tabla definitiva y conversación ofrece **Editar**. Permite cambiar clasificación, responsable, asociación, estado e ignorado. La actualización es transaccional, recalcula conversaciones y métricas y registra fecha, identidad de sesión y valores anterior/nuevo. Con acceso compartido, la auditoría identifica la cuenta técnica compartida, no distingue personas que usen la misma clave. Una versión del registro evita sobrescribir cambios concurrentes.

**Ignorados** conserva el contenido, procedencias y motivo, pero excluye el mensaje de las métricas de atención. Ignorar una solicitud excluye también sus respuestas de estas métricas; restaurarla recupera el cálculo. Ignorar la primera respuesta permite usar la siguiente respuesta válida.

**Pendiente (fuera del horario)** se aplica desde las 16:50 Caracas sin respuesta válida, permanece así hasta una respuesta aprobada o corrección manual y no aparece simultáneamente en No respondidas. La tasa usa respondidas / (respondidas + no respondidas), excluyendo pendientes fuera del horario e ignorados. Recibir una respuesta en staging no modifica todavía el histórico: cambia al aprobarla.

Una solicitud puede marcarse **Respondida manualmente**, sin inventar un correo ni tiempo de respuesta. Una **Respuesta del personal sin asociación** cuenta por persona, pero no responde solicitudes ni genera tiempo; puede relacionarse más adelante con un original compatible o mediante edición. Su filtro de fecha usa la fecha de envío mientras no esté asociada.

No se requiere migración de esquema: ajustes y auditoría amplían el JSONB de decisiones existente; los estados de atención se derivan de fechas, respuestas válidas y ajustes. Los respaldos conservan estos campos y siguen aceptando respaldos anteriores.

## Limpieza por fecha de importación

Configuración permite elegir hoy, fecha, rango de fechas, un minuto específico o rango fecha/hora, en Caracas. Se filtra **imports.createdAt**, nunca la fecha interna del mensaje. El minuto final seleccionado se incluye. Primero se previsualizan importaciones, correos afectados, correos oficiales que se eliminarán, solicitudes/respuestas oficiales, registros de revisión y correos compartidos que se conservarán. Se exige escribir **ELIMINAR** antes de ejecutar. Si cambia la selección o el contenido desde el preview, la operación se rechaza y exige una nueva previsualización.

La limpieza elimina las importaciones y sus procedencias/staging, borra únicamente correos sin otra procedencia y reconstruye conversaciones. No borra personal, buzón, configuración, usuarios ni sesiones. No se ejecuta ninguna limpieza automática al desplegar. Esta actualización utiliza el esquema existente; **no requiere nuevas migraciones PostgreSQL**.

## Reporte HTML autónomo

El botón del Dashboard usa los filtros actuales. Genera un único archivo `.html` con CSS incluido, sin CDN, fuentes remotas, scripts externos ni llamadas de red. Los detalles se despliegan con `<details>`, por lo que no requiere JavaScript. Incluye resumen, respuestas por persona, solicitudes respondidas, correos iniciados y no respondidos. Todo texto del correo se escapa como HTML. Puede abrirse offline en PC o móvil; la aplicación elegida para abrir archivos en cada teléfono debe admitir HTML.

## Respaldo y restauración

En Configuración se descarga `.jsonl`: un formato JSON por línea que permite procesar respaldos sin cargar el archivo entero. Incluye una cabecera de versión, registros por tabla y cierre con conteos; exporta una instantánea de lectura repetible. No incluye contraseñas ni sesiones. Las conversaciones son derivadas y se reconstruyen al restaurar.

La restauración lee el archivo por fragmentos, valida y guarda lotes en `restore_rows`. Muestra un resumen y exige escribir **RESTAURAR**. Solo entonces reemplaza los datos corporativos dentro de una transacción y reconstruye relaciones. Conserva las cuentas de acceso de la instalación. Si faltan el cierre, filas, procedencias o claves relacionadas, falla sin sustituir el histórico. El botón Cancelar elimina el staging del respaldo.

Guarda los respaldos en un lugar corporativo protegido. Para históricos muy grandes conviene además habilitar recuperación/PITR y respaldos nativos de PostgreSQL en el proveedor: el reporte y la restauración web siguen sujetos al tiempo máximo de ejecución del plan Vercel. La asociación reconstruye metadata del histórico en memoria del servidor; debe revisarse rendimiento y evolucionar hacia reconciliación incremental antes de operar con millones de mensajes. Las tablas y claves permiten esa evolución sin alterar la fuente de verdad.

## Pruebas y verificaciones

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
npm run test:large-zip
```

Las dos últimas usan Chrome instalado, puertos locales 3107/55439 y PostgreSQL WASM de prueba; requieren haber ejecutado el build. Para Edge, usa `E2E_BROWSER=msedge` en el entorno. Generan exclusivamente datos sintéticos en `test-results/`, que está ignorado por Git. El ZIP grande requiere aproximadamente 502 MB de disco. Las pruebas no se conectan a Neon ni usan `.env` de producción.

Las pruebas cubren parser MIME, charsets, acentos, referencias, normalización, solicitudes, respuestas del siguiente día, múltiples respuestas, iniciados, ambigüedad, cronología, staging invisible al histórico, aprobación parcial, rollback, rechazo, reanudación, duplicados, reversión, filtros, búsqueda, HTML y restauración.

La inspección local opcional muestra solo conteos y no guarda el contenido:

```bash
npm run inspect:zip -- "ruta/al/ejemplo.zip"
```

Consulta [la verificación del ejemplo y los límites](docs/VALIDACION.md). Los ZIP/EML reales, `.env`, respaldos y resultados de prueba están excluidos de Git. El archivo `app.py` preexistente se conserva sin modificar; no forma parte de la aplicación Next.js.
