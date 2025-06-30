import os
import json
import functions_framework
from flask import Request, Response
from google import genai
from google.genai import types
from google.oauth2 import service_account

MODEL_ID   = "gemini-2.5-flash"
LOCATION   = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
SA_FILE    = os.getenv("SERVICE_ACCOUNT_FILE", "credential.json")

creds = service_account.Credentials.from_service_account_file(
    SA_FILE, scopes=["https://www.googleapis.com/auth/cloud-platform"]
)

client = genai.Client(
    vertexai=True,
    project=creds.project_id,
    location=LOCATION,
    credentials=creds
)

@functions_framework.http
def main(request: Request):
    if request.method == "OPTIONS":
        return Response(
            "204 No Content",
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Max-Age": "3600"
            },
        )

    body = request.get_json(silent=True) or {}
    transcript = body.get("transcript")
    keyword = body.get("keyword")
    max_tokens = int(body.get("maxTokens", 8192))

    if transcript is None:
        return ("`transcript` is required", 400)

    if keyword is None:
        return ("`keyword` is required", 400)

    prompt = f"""
# ==== System Instruction ====
XXX

# ==== Objective & Persona ====
XXX

# ==== Instructions ====
XXX

# ==== Constraints ====
XXX

# ==== Context ====
XXX

# ==== OUTPUT_FORMAT ====
XXX
"""

    resp = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(
            max_output_tokens=max_tokens,
            temperature=0.3,
            thinking_config=types.ThinkingConfig(
                thinking_budget=0
            )
        )
    )

    return Response(
        json.dumps({"response": resp.text}, ensure_ascii=False),
        status=200,
        content_type="application/json; charset=utf-8",
        headers={
            "Access-Control-Allow-Origin": "*"
        },
    )