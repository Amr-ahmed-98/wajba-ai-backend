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
          ? "https://railway.com/project/e6e74923-8b47-40a0-929a-2627b0cebff4?environmentId=90d79499-89da-41fa-8213-9c65aa2b9f2e"   // your deployed URL later
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