FROM python:3.12-slim

WORKDIR /app

# System deps for pymupdf + playwright
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libgl1 \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency installs
RUN pip install uv

COPY pyproject.toml .
RUN uv pip install --system .

# Install Playwright browsers (needed for browser-use)
RUN playwright install chromium --with-deps

COPY app/ ./app/

# Create runtime directories
RUN mkdir -p uploads data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
