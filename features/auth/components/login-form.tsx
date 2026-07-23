"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { loginAction } from "@/actions/auth.actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema, type LoginInput } from "@/features/auth/schemas/login.schema";

interface LoginFormProps {
  callbackUrl: string;
}

export function LoginForm({ callbackUrl }: LoginFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const formData = new FormData();
    formData.set("username", values.username);
    formData.set("password", values.password);
    formData.set("callbackUrl", callbackUrl);

    startTransition(async () => {
      const result = await loginAction({ error: null }, formData);
      if (result.error) {
        setServerError(result.error);
      }
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={1}>
          Sign in
        </CardTitle>
        <CardDescription>Sign in with your Courtroom staff account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" type="text" autoComplete="username" {...register("username")} />
            {errors.username ? (
              <p className="text-destructive text-sm">{errors.username.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
            {errors.password ? (
              <p className="text-destructive text-sm">{errors.password.message}</p>
            ) : null}
          </div>

          {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
