import asyncio
import json
import logging
import os
from typing import Any, Awaitable, Callable, Dict, Optional

import aiomqtt
import httpx

logger = logging.getLogger(__name__)

COMMAND_TOPIC = "trainiq/command/download"
STATUS_TOPIC = "trainiq/status/download"
RECONNECT_DELAY_SECONDS = 10

CommandHandler = Callable[[str], Awaitable[Dict[str, Any]]]


class MqttService:
    def __init__(self, config: Dict[str, Any], handler: CommandHandler) -> None:
        self.config = config
        self.handler = handler

    async def _resolve_connection(self) -> Optional[Dict[str, Any]]:
        host = (self.config.get("mqtt_host") or "").strip()
        if host:
            return {
                "hostname": host,
                "port": int(self.config.get("mqtt_port") or 1883),
                "username": self.config.get("mqtt_username") or None,
                "password": self.config.get("mqtt_password") or None,
            }

        token = os.getenv("SUPERVISOR_TOKEN")
        if not token:
            return None
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "http://supervisor/services/mqtt",
                    headers={"Authorization": f"Bearer {token}"},
                )
            if resp.status_code != 200:
                return None
            data = resp.json().get("data") or {}
            if not data.get("host"):
                return None
            return {
                "hostname": data["host"],
                "port": int(data.get("port") or 1883),
                "username": data.get("username"),
                "password": data.get("password"),
            }
        except Exception as e:
            logger.warning("MQTT service discovery failed: %s", e)
            return None

    async def _publish_status(self, client: aiomqtt.Client, payload: Dict[str, Any]) -> None:
        await client.publish(STATUS_TOPIC, json.dumps(payload, default=str), retain=True)

    async def _handle_message(self, client: aiomqtt.Client, command: str) -> None:
        logger.info("MQTT command received: %s", command)
        await self._publish_status(client, {"command": command, "state": "running"})
        try:
            result = await self.handler(command)
            await self._publish_status(client, {"command": command, "state": "done", "result": result})
        except Exception as e:
            logger.error("MQTT command '%s' failed: %s", command, e)
            await self._publish_status(client, {"command": command, "state": "error", "error": str(e)})

    async def run(self) -> None:
        while True:
            conn = await self._resolve_connection()
            if not conn:
                logger.info("MQTT not configured and no broker found — MQTT commands disabled")
                return
            try:
                async with aiomqtt.Client(**conn) as client:
                    await client.subscribe(COMMAND_TOPIC)
                    logger.info("MQTT connected, listening on %s", COMMAND_TOPIC)
                    async for message in client.messages:
                        raw = message.payload
                        text = raw.decode("utf-8", errors="ignore") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
                        await self._handle_message(client, text.strip())
            except aiomqtt.MqttError as e:
                logger.warning("MQTT connection lost: %s — retrying in %ds", e, RECONNECT_DELAY_SECONDS)
                await asyncio.sleep(RECONNECT_DELAY_SECONDS)