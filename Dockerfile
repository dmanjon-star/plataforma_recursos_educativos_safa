# Imagen para publicar Recursos SAFA en cualquier servicio que acepte Docker.
# Los datos privados (cuentas, pagos, cursos) van en /app/data/privado:
# monta ahí un volumen persistente para no perderlos al actualizar.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# El catálogo (data/catalogo.json) y los archivos subidos se escriben en tiempo de ejecución
RUN mkdir -p data/privado data/archivos && chown -R node:node /app/data
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
VOLUME ["/app/data/privado"]
USER node
CMD ["node", "servidor/servidor.js"]
