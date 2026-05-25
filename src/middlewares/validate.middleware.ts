import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

// Accepts ZodSchema (not ZodObject) so it works with .refine() and .superRefine()
const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.issues.map((err) => ({
          field: err.path.slice(1).join("."), // Remove the leading "body" segment
          message: err.message,
        }));
        res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: formattedErrors,
        });
        return;
      }
      next(error); // Pass unexpected errors to error handler
    }
  };
};

export default validate;