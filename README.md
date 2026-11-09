# AT-PAC Agenda de Bodegas

Primera base productiva para coordinar retiros y entregas de material.

## Incluye

- Login con correo y contraseña.
- Roles: ADMIN, OPERACIONES y CLIENTE.
- Solo ADMIN puede crear usuarios.
- Reservas de tres horas con validación de cruces.
- Operaciones acepta, rechaza, cancela o reagenda usando calendario y horas disponibles.
- Notificaciones por correo al crear, aceptar, rechazar, cancelar o reagendar.
- Administración completa de usuarios y exportación de datos a Excel/PDF.
- Cliente visualiza el estado y comentario de Operaciones.
- PostgreSQL y almacenamiento de archivos configurable.

## Ejecución local

1. Crear una base PostgreSQL.
2. Copiar `backend/.env.example` como `backend/.env`.
3. Ejecutar `npm install` dentro de `backend` y `frontend`.
4. Ejecutar `npm run dev` en ambas carpetas.

## Primer administrador

Al iniciar el backend se crea el administrador indicado en `ADMIN_EMAIL` y
`ADMIN_PASSWORD` si aún no existe.

## Render

- Backend: Web Service, carpeta raíz `backend`, comando `npm start`.
- Frontend: Static Site, carpeta raíz `frontend`, build `npm run build`,
  publicación `dist`.
- PostgreSQL: agregar `DATABASE_URL` al backend.
- Archivos: agregar Persistent Disk y configurar `UPLOAD_DIR=/var/data/uploads`.
- Correo: configurar `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASSWORD` y `MAIL_FROM` en el backend.

