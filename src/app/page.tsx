import { Header } from '@/components/layout/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle, Clock, FileCode } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="flex flex-col h-full">
      <Header title="Dashboard" />

      <div className="flex-1 p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Tests</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <FileCode className="h-5 w-5 text-muted-foreground" />
                0
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Passing</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                0
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failing</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2 text-destructive">
                <XCircle className="h-5 w-5" />
                0
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Last Run</CardDescription>
              <CardTitle className="text-xl flex items-center gap-2 text-muted-foreground">
                <Clock className="h-5 w-5" />
                Never
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Test Runs</CardTitle>
            <CardDescription>Your latest test execution results</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <FileCode className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No test runs yet</p>
              <p className="text-sm">Record your first test to get started</p>
            </div>
          </CardContent>
        </Card>

        {/* Functional Areas */}
        <Card>
          <CardHeader>
            <CardTitle>Functional Areas</CardTitle>
            <CardDescription>Test coverage by functional area</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <p>No functional areas defined</p>
              <p className="text-sm">Create areas when recording tests</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
