FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000 MESA_DATA_DIR=/data
WORKDIR /app
COPY . /app
RUN useradd --create-home mesa && mkdir -p /data && chown -R mesa:mesa /data /app
USER mesa
EXPOSE 8000
CMD ["python", "app.py"]
