ARG BUILD_FROM
FROM $BUILD_FROM

# Install Python 3.12 and build deps
# Use python3.12 package explicitly to avoid Alpine shipping 3.14
RUN apk add --no-cache \
    python3.12 \
    python3.12-dev \
    py3.12-pip \
    nodejs \
    npm \
    gcc \
    musl-dev \
    libffi-dev \
    openssl-dev \
    geos \
    geos-dev \
    g++ \
    openblas-dev \
    && ln -sf /usr/bin/python3.12 /usr/local/bin/python3 \
    && ln -sf /usr/bin/python3.12 /usr/local/bin/python3.12 \
    && ln -sf /usr/bin/pip3.12 /usr/local/bin/pip3

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
    --prefer-binary \
    -r requirements.txt

COPY frontend /app/frontend
WORKDIR /app/frontend
RUN npm install
RUN npm run build

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
