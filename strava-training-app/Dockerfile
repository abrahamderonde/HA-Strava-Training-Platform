ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache \
    python3 \
    py3-pip \
    nodejs \
    npm \
    gcc \
    musl-dev \
    python3-dev \
    libffi-dev \
    openssl-dev \
    geos \
    geos-dev \
    g++ \
    openblas-dev

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
    --prefer-binary \
    -r requirements.txt

COPY frontend /app/frontend
WORKDIR /app/frontend
RUN npm install 2>&1 && npm run build 2>&1

WORKDIR /app
COPY backend /app/backend

RUN mkdir -p /data/strava_training

RUN mkdir -p /etc/services.d/strava-training \
    && echo '#!/usr/bin/with-contenv sh' > /etc/services.d/strava-training/run \
    && echo 'export DATA_PATH="/data/strava_training"' >> /etc/services.d/strava-training/run \
    && echo 'mkdir -p "${DATA_PATH}"' >> /etc/services.d/strava-training/run \
    && echo 'cd /app' >> /etc/services.d/strava-training/run \
    && echo 'exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8088 --workers 1 --log-level info' >> /etc/services.d/strava-training/run \
    && chmod 755 /etc/services.d/strava-training/run

EXPOSE 8088
