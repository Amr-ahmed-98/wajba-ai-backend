// src/config/swagger.ts
import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Wajba API",
      version: "1.0.0",
      description: "API documentation for Wajba smart kitchen app",
    },
    servers: [
      {
        url: process.env.NODE_ENV === "production"
          ? "https://wajba-ai-backend-production.up.railway.app" 
          : "http://localhost:3000",
        description: process.env.NODE_ENV === "production" ? "Production" : "Local",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  // Swagger reads JSDoc comments from these files automatically
  apis: ["./src/api/**/*.routes.ts", "./src/api/**/*.controller.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);