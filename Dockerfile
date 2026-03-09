# Stage 1: Build the Vue frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# Override base to / so the app works at the container root, not /BballTactics/
RUN npx vite build --base /

# Stage 2: Python API runtime
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
# Keep public/ for the /api/roster endpoint
COPY public/ public/
# Copy the built frontend from stage 1
COPY --from=frontend-build /app/dist ./dist

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
