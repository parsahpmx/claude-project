# VYRA engine image.
#
# The engine core depends only on the standard library plus PyYAML, so the runtime image
# stays small and its dependency surface stays auditable.  Research and service extras are
# installed only in the images that need them.

FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Run as a non-root user: the trading process has no reason to be root, and a container
# escape from a process holding broker credentials is the worst case worth designing out.
RUN groupadd --gid 10001 vyra && \
    useradd --uid 10001 --gid vyra --create-home --shell /usr/sbin/nologin vyra

COPY pyproject.toml ./
COPY core ./core
COPY brokers ./brokers
COPY data ./data
COPY apps ./apps
COPY configs ./configs
COPY scripts ./scripts

FROM base AS engine
RUN pip install --no-cache-dir -e "." && chown -R vyra:vyra /app
USER vyra
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import core; print(core.__version__)" || exit 1
CMD ["python", "scripts/run_backtest.py", "--help"]

FROM base AS research
RUN pip install --no-cache-dir -e ".[dev,data,ml]" && chown -R vyra:vyra /app
USER vyra
CMD ["pytest", "-q"]

# The API. Separate from the engine image because it carries a web stack the trading
# process has no reason to load, and because the two scale and restart independently.
#
# It starts with no credentials of its own: VYRA_API_SECRET and VYRA_API_USERS are supplied
# at run time and the service refuses to start without them, so an image built from this
# file cannot ship a usable default account.
FROM base AS api
RUN pip install --no-cache-dir -e ".[api]" && chown -R vyra:vyra /app
USER vyra
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1
CMD ["uvicorn", "apps.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
