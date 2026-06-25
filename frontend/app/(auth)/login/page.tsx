import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// URL: /login (the (auth) route group adds no path segment).
// Placeholder server component — the real login form lands in plan 04-02.
export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to RestaurantOS</CardTitle>
        <CardDescription>The login form arrives in plan 04-02.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Authentication shell placeholder.</p>
      </CardContent>
    </Card>
  );
}
