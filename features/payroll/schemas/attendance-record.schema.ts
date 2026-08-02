import { z } from "zod";

export const createManualAttendanceEntrySchema = z
  .object({
    employeeId: z.string().min(1, "Select an employee."),
    workDate: z.coerce.date(),
    clockIn: z.coerce.date(),
    clockOut: z.coerce.date().optional(),
  })
  .refine((data) => !data.clockOut || data.clockOut > data.clockIn, {
    message: "Clock out must be after clock in.",
    path: ["clockOut"],
  });

export type CreateManualAttendanceEntryInput = z.infer<typeof createManualAttendanceEntrySchema>;

export const correctAttendanceEntrySchema = z
  .object({
    recordId: z.string().min(1),
    clockIn: z.coerce.date(),
    clockOut: z.coerce.date().optional(),
    reason: z.string().min(1, "Enter a reason for this correction."),
  })
  .refine((data) => !data.clockOut || data.clockOut > data.clockIn, {
    message: "Clock out must be after clock in.",
    path: ["clockOut"],
  });

export type CorrectAttendanceEntryInput = z.infer<typeof correctAttendanceEntrySchema>;
