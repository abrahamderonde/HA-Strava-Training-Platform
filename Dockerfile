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

# Data directory
RUN mkdir -p /data/strava_training

# Write s6 run script using echo and chmod separately
RUN mkdir -p /etc/services.d/strava-training
RUN echo '#!/usr/bin/with-contenv sh' > /etc/services.d/strava-training/run
RUN echo 'export DATA_PATH="/data/strava_training"' >> /etc/services.d/strava-training/run
RUN echo 'mkdir -p "${DATA_PATH}"' >> /etc/services.d/strava-training/run
RUN echo 'exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8088 --workers 1 --log-level info' >> /etc/services.d/strava-training/run
RUN chmod 755 /etc/services.d/strava-training/run
RUN cat /etc/services.d/strava-training/run
RUN ls -la /etc/services.d/strava-training/

EXPOSE 8088
