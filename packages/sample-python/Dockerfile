FROM python:3-alpine

# Install any additional dependencies if needed
RUN apk add --no-cache --virtual .build-deps gcc musl-dev

# Create app directory
WORKDIR /app

# Copy requirements (if any)
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Remove build dependencies
RUN apk del .build-deps

# Copy application code
COPY app.py .

# Expose port
EXPOSE 8080

# Run the application
CMD ["python", "app.py"] 