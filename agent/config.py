"""Typed settings for the LOOP agent. All secrets come from env — never hardcode."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Splunk MCP Server
    splunk_mcp_url: str = ""
    splunk_mcp_token: str = ""
    # Local Splunk Enterprise serves 8089 with a self-signed cert — set 0 to
    # skip TLS verification for localhost. Keep 1 for real/Cloud endpoints.
    splunk_verify_tls: bool = True

    # Splunk HEC — only used by the seed loader (agent/seed/load_seed.py).
    splunk_hec_url: str = "https://localhost:8088/services/collector/event"
    splunk_hec_token: str = ""

    # Splunk Hosted Models (Foundation-Sec-8B, OpenAI-compatible)
    hosted_model_url: str = ""
    hosted_model_key: str = ""
    hosted_model_name: str = "foundation-sec-8b"

    # Orchestrator fallback
    anthropic_api_key: str = ""

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""

    # App
    loop_cors_origins: str = "http://localhost:3000"
    loop_allow_stubs: bool = True

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.loop_cors_origins.split(",") if o.strip()]

    @property
    def has_splunk(self) -> bool:
        return bool(self.splunk_mcp_url and self.splunk_mcp_token)

    @property
    def has_hosted_model(self) -> bool:
        return bool(self.hosted_model_url and self.hosted_model_key)

    @property
    def has_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
