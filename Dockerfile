ARG BUILD_FROM
FROM $BUILD_FROM

# Install Python, Node.js and build tools
RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-numpy \
    py3-scipy \
    nodejs \
    npm \
    gcc \
    musl-dev \
    python3-dev \
    libffi-dev \
    openssl-dev \
    geos \
    geos-dev

WORKDIR /app

# Install Python dependencies
# --prefer-binary avoids compiling wheels from source (important for ARM)
COPY backend/requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
    --prefer-binary \
    -r requirements.txt

# Build React frontend
COPY frontend /app/frontend
WORKDIR /app/frontend
RUN npm install && npm run build || echo "WARNING: Frontend build failed"

WORKDIR /app
COPY backend /app/backend

# Copy s6 service scripts and make run scripts executable
COPY rootfs /
RUN chmod +x /etc/services.d/strava-training/run

# Data directory
RUN mkdir -p /data/strava_training

EXPOSE 8088

CMD ["python3", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8088"]
