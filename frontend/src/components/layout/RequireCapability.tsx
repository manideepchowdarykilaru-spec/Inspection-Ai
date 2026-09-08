import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { Capability } from '@/services/authService';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { ROLE_LABEL } from '@shared/lib/format';

/** Route-level enforcement of the role capability matrix. */
export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { can, user } = useAuth();
  const navigate = useNavigate();

  if (can(capability)) return <>{children}</>;

  return (
    <div className="surface py-6">
      <EmptyState
        icon={<ShieldX size={20} />}
        title="Access restricted"
        description={`This workspace is not available to the ${user ? ROLE_LABEL[user.role] : 'current'} role. Contact the department administrator if you require access.`}
        action={
          <Button size="sm" variant="outline" onClick={() => navigate('/app')}>
            Return to dashboard
          </Button>
        }
      />
    </div>
  );
}
