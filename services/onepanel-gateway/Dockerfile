FROM node:24-trixie-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json gateway.mts ./
EXPOSE 4402
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4402/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "gateway.mts"]
