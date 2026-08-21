from pydantic import BaseModel


class GeminiSettingsPayload(BaseModel):
    cookies: str = ""
    client_context_token: str = ""
    app_url: str = "https://gemini.google.com/app"
