'use client';

import { route } from '@/lib/route';
import { useState } from 'react';
import { router, usePage } from '@/lib/inertia-compat';
import { ColumnDef } from '@tanstack/react-table';
import AdminLayout from '@/Layouts/AdminLayout';
import { AdminPageHeader } from '@/components/Admin/AdminPageHeader';
import { useAppDate } from '@/lib/date';
import { useAdminLoading } from '@/hooks/useAdminLoading';
import { TableSkeleton, type TableColumnConfig } from '@/components/Admin/skeletons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    TableActionMenu,
    TableActionMenuTrigger,
    TableActionMenuContent,
    TableActionMenuItem,
    TableActionMenuLabel,
    TableActionMenuSeparator,
} from '@/components/ui/table-action-menu';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Pencil, UserCircle, Eye, Coins, Calendar, CreditCard } from 'lucide-react';
import { User, PageProps } from '@/types';
import { AdminUser, PaginationData } from '@/types/admin';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/LanguageContext';

interface AdminPlanOption {
    id: string;
    name: string;
    price: number;
    billing_period: string;
    monthly_build_credits: number;
}

interface UsersProps {
    user: User;
    users: {
        data: AdminUser[];
    };
    plans?: AdminPlanOption[];
    pagination: PaginationData;
}

// Skeleton column configuration for Users table
const skeletonColumns: TableColumnConfig[] = [
    { type: 'avatar-text', width: 'w-48' },   // User (name + email)
    { type: 'badge', width: 'w-16' },         // Role
    { type: 'badge', width: 'w-24' },         // Plan
    { type: 'text', width: 'w-24' },          // Credits
    { type: 'text', width: 'w-24' },          // Expires
    { type: 'status', width: 'w-32' },        // Status (switch + badge)
    { type: 'text', width: 'w-16' },          // Projects
    { type: 'text', width: 'w-24' },          // Joined
    { type: 'actions', width: 'w-12' },       // Actions
];

export default function Users({ user, users, plans = [], pagination: _pagination }: UsersProps) {
    const { t } = useTranslation();
    const { formatDate } = useAppDate();
    const { isDemo } = usePage<PageProps>().props;
    const { isLoading } = useAdminLoading();
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
    const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        role: 'user' as 'admin' | 'user',
        status: 'active' as 'active' | 'inactive',
        plan_id: 'none',
        plan_expires_at: '',
        build_credits: '0',
    });

    const resetForm = () => {
        setFormData({
            name: '',
            email: '',
            password: '',
            role: 'user',
            status: 'active',
            plan_id: 'none',
            plan_expires_at: '',
            build_credits: '0',
        });
        setFormErrors({});
    };

    const validateForm = (isEdit: boolean) => {
        const errors: Record<string, string> = {};
        if (!formData.name.trim()) {
            errors.name = t('Name is required');
        }
        if (!formData.email.trim()) {
            errors.email = t('Email is required');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            errors.email = t('Invalid email format');
        }
        if (!isEdit && !formData.password.trim()) {
            errors.password = t('Password is required');
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleAdd = () => {
        if (!validateForm(false)) {
            return;
        }
        router.post(route('admin.users.store'), formData, {
            onSuccess: () => {
                setIsAddDialogOpen(false);
                resetForm();
                toast.success(t('User created successfully'));
            },
            onError: (errors) => {
                setFormErrors(errors as Record<string, string>);
                toast.error(Object.values(errors)[0] as string);
            },
        });
    };

    const handleEdit = () => {
        if (!selectedUser) return;

        if (!validateForm(true)) {
            return;
        }

        const updateData: Record<string, any> = {
            name: formData.name,
            email: formData.email,
            role: formData.role,
            status: formData.status,
            plan_id: formData.plan_id === 'none' ? null : formData.plan_id,
            plan_expires_at: formData.plan_expires_at || null,
            build_credits: Number(formData.build_credits || 0),
        };

        if (formData.password) {
            updateData.password = formData.password;
        }

        router.put(route('admin.users.update', selectedUser.id), updateData, {
            onSuccess: () => {
                setIsEditDialogOpen(false);
                setSelectedUser(null);
                resetForm();
                toast.success(t('User updated successfully'));
            },
            onError: (errors) => {
                setFormErrors(errors as Record<string, string>);
                toast.error(Object.values(errors)[0] as string);
            },
        });
    };

    const handleDelete = (adminUser: AdminUser) => {
        if (adminUser.id === user.id) {
            toast.error(t('You cannot delete your own account'));
            return;
        }
        setUserToDelete(adminUser);
        setIsDeleteDialogOpen(true);
    };

    const confirmDelete = () => {
        if (!userToDelete) return;
        router.delete(route('admin.users.destroy', userToDelete.id), {
            onSuccess: () => {
                toast.success(t('User deleted'));
                setIsDeleteDialogOpen(false);
                setUserToDelete(null);
            },
            onError: () => toast.error(t('Failed to delete user')),
        });
    };

    const handleImpersonate = (adminUser: AdminUser) => {
        router.post(route('admin.users.impersonate', adminUser.id));
    };

    const handleToggleStatus = (adminUser: AdminUser) => {
        router.put(route('admin.users.update', adminUser.id), {
            status: adminUser.status === 'active' ? 'inactive' : 'active',
        }, {
            preserveScroll: true,
            onSuccess: () => toast.success(t('Status updated')),
        });
    };

    const openEditDialog = (adminUser: AdminUser) => {
        setSelectedUser(adminUser);
        const formattedExpiry = adminUser.plan_expires_at
            ? new Date(adminUser.plan_expires_at).toISOString().slice(0, 10)
            : '';
        setFormData({
            name: adminUser.name,
            email: adminUser.email,
            password: '',
            role: adminUser.role,
            status: adminUser.status,
            plan_id: adminUser.plan_id || 'none',
            plan_expires_at: formattedExpiry,
            build_credits: String(adminUser.build_credits ?? 0),
        });
        setIsEditDialogOpen(true);
    };

    const columns: ColumnDef<AdminUser>[] = [
        {
            accessorKey: 'name',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('User')} />
            ),
            cell: ({ row }) => {
                const adminUser = row.original;
                return (
                    <div className="flex items-center gap-2">
                        <UserCircle className="h-4 w-4 text-muted-foreground" />
                        <div>
                            <p className="font-medium">{adminUser.name}</p>
                            <p className="text-sm text-muted-foreground">{adminUser.email}</p>
                        </div>
                    </div>
                );
            },
        },
        {
            accessorKey: 'role',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Role')} />
            ),
            cell: ({ row }) => {
                const role = row.original.role;
                return (
                    <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
                        {role === 'admin' ? t('Admin') : t('User')}
                    </Badge>
                );
            },
        },
        {
            accessorKey: 'plan_name',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Plan')} />
            ),
            cell: ({ row }) => {
                const planName = row.original.plan_name;
                return (
                    <Badge variant={planName ? 'outline' : 'secondary'}>
                        {planName || t('Free / Default')}
                    </Badge>
                );
            },
        },
        {
            accessorKey: 'build_credits',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Credits')} />
            ),
            cell: ({ row }) => {
                const adminUser = row.original;
                if (adminUser.role === 'admin') {
                    return <Badge variant="secondary">{t('Unlimited')}</Badge>;
                }
                const creditsVal = Number(adminUser.build_credits ?? 0);
                return (
                    <span className="font-mono text-xs font-medium">
                        {creditsVal.toLocaleString()}
                    </span>
                );
            },
        },
        {
            accessorKey: 'plan_expires_at',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Expires')} />
            ),
            cell: ({ row }) => {
                const exp = row.original.plan_expires_at;
                return exp ? (
                    <span className="text-xs text-muted-foreground">{formatDate(exp)}</span>
                ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                );
            },
        },
        {
            accessorKey: 'status',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Status')} />
            ),
            cell: ({ row }) => {
                const adminUser = row.original;
                return (
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={adminUser.status === 'active'}
                            onCheckedChange={() => handleToggleStatus(adminUser)}
                            disabled={adminUser.id === user.id}
                        />
                        <Badge variant={adminUser.status === 'active' ? 'default' : 'secondary'}>
                            {adminUser.status === 'active' ? t('Active') : t('Inactive')}
                        </Badge>
                    </div>
                );
            },
        },
        {
            accessorKey: 'projects_count',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Projects')} />
            ),
            cell: ({ row }) => row.original.projects_count,
        },
        {
            accessorKey: 'created_at',
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t('Joined')} />
            ),
            cell: ({ row }) => formatDate(row.original.created_at),
        },
        {
            id: 'actions',
            enableHiding: false,
            cell: ({ row }) => {
                const adminUser = row.original;
                return (
                    <TableActionMenu>
                        <TableActionMenuTrigger />
                        <TableActionMenuContent align="end">
                            <TableActionMenuLabel>{t('Actions')}</TableActionMenuLabel>
                            {!isDemo && adminUser.role !== 'admin' && adminUser.id !== user.id && (
                                <TableActionMenuItem onClick={() => handleImpersonate(adminUser)}>
                                    <Eye className="me-2 h-4 w-4" />
                                    {t('Impersonate')}
                                </TableActionMenuItem>
                            )}
                            <TableActionMenuItem onClick={() => openEditDialog(adminUser)}>
                                <Pencil className="me-2 h-4 w-4" />
                                {t('Edit')}
                            </TableActionMenuItem>
                            {adminUser.id !== user.id && (
                                <>
                                    <TableActionMenuSeparator />
                                    <TableActionMenuItem
                                        variant="destructive"
                                        onClick={() => handleDelete(adminUser)}
                                    >
                                        <Trash2 className="me-2 h-4 w-4" />
                                        {t('Delete')}
                                    </TableActionMenuItem>
                                </>
                            )}
                        </TableActionMenuContent>
                    </TableActionMenu>
                );
            },
        },
    ];

    return (
        <AdminLayout user={user} title={t('Users')}>
            <AdminPageHeader
                title={t('Users')}
                subtitle={t('Manage all registered users')}
                action={
                    <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
                        setIsAddDialogOpen(open);
                        if (!open) resetForm();
                    }}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="h-4 w-4 me-2" />
                                {t('Create User')}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>{t('Create User')}</DialogTitle>
                                <DialogDescription>
                                    {t('Add a new user to the system')}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">{t('Name')}</Label>
                                    <Input
                                        id="name"
                                        placeholder={t('John Doe')}
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className={formErrors.name ? 'border-destructive' : ''}
                                    />
                                    {formErrors.name && (
                                        <p className="text-sm text-destructive">{formErrors.name}</p>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">{t('Email')}</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="john@example.com"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className={formErrors.email ? 'border-destructive' : ''}
                                    />
                                    {formErrors.email && (
                                        <p className="text-sm text-destructive">{formErrors.email}</p>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">{t('Password')}</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="********"
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        className={formErrors.password ? 'border-destructive' : ''}
                                    />
                                    {formErrors.password && (
                                        <p className="text-sm text-destructive">{formErrors.password}</p>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="role">{t('Role')}</Label>
                                        <Select
                                            value={formData.role}
                                            onValueChange={(value: 'admin' | 'user') =>
                                                setFormData({ ...formData, role: value })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder={t('Select role')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="user">{t('User')}</SelectItem>
                                                <SelectItem value="admin">{t('Admin')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="status">{t('Status')}</Label>
                                        <Select
                                            value={formData.status}
                                            onValueChange={(value: 'active' | 'inactive') =>
                                                setFormData({ ...formData, status: value })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder={t('Select status')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="active">{t('Active')}</SelectItem>
                                                <SelectItem value="inactive">{t('Inactive')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                                    {t('Cancel')}
                                </Button>
                                <Button onClick={handleAdd}>{t('Create User')}</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                }
            />

            {isLoading ? (
                <TableSkeleton
                    columns={skeletonColumns}
                    rows={10}
                    showSearch
                />
            ) : (
                <DataTable
                    columns={columns}
                    data={users.data}
                    searchKey="name"
                    searchPlaceholder={t('Search users...')}
                />
            )}

            {/* Edit Dialog */}
            <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
                setIsEditDialogOpen(open);
                if (!open) resetForm();
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('Edit User')}</DialogTitle>
                        <DialogDescription>
                            {t('Update user information')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="edit-name">{t('Name')}</Label>
                            <Input
                                id="edit-name"
                                placeholder={t('John Doe')}
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className={formErrors.name ? 'border-destructive' : ''}
                            />
                            {formErrors.name && (
                                <p className="text-sm text-destructive">{formErrors.name}</p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-email">{t('Email')}</Label>
                            <Input
                                id="edit-email"
                                type="email"
                                placeholder="john@example.com"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className={formErrors.email ? 'border-destructive' : ''}
                            />
                            {formErrors.email && (
                                <p className="text-sm text-destructive">{formErrors.email}</p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-password">{t('New Password (leave blank to keep current)')}</Label>
                            <Input
                                id="edit-password"
                                type="password"
                                placeholder="********"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="edit-role">{t('Role')}</Label>
                                <Select
                                    value={formData.role}
                                    onValueChange={(value: 'admin' | 'user') =>
                                        setFormData({ ...formData, role: value })
                                    }
                                    disabled={selectedUser?.id === user.id}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="user">{t('User')}</SelectItem>
                                        <SelectItem value="admin">{t('Admin')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="edit-status">{t('Status')}</Label>
                                <Select
                                    value={formData.status}
                                    onValueChange={(value: 'active' | 'inactive') =>
                                        setFormData({ ...formData, status: value })
                                    }
                                    disabled={selectedUser?.id === user.id}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active">{t('Active')}</SelectItem>
                                        <SelectItem value="inactive">{t('Inactive')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Plan, Expiration & Build Credits Management */}
                        <div className="border-t pt-4 space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="edit-plan" className="flex items-center gap-1.5">
                                        <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                                        {t('Subscription Plan')}
                                    </Label>
                                    <Select
                                        value={formData.plan_id}
                                        onValueChange={(value: string) => {
                                            const matched = plans.find((p) => p.id === value);
                                            const nextCredits =
                                                matched && matched.monthly_build_credits >= 0
                                                    ? String(matched.monthly_build_credits)
                                                    : formData.build_credits;
                                            let nextExpiry = formData.plan_expires_at;
                                            if (matched && !nextExpiry) {
                                                const d = new Date();
                                                d.setDate(
                                                    d.getDate() + (matched.billing_period === 'yearly' ? 365 : 30)
                                                );
                                                nextExpiry = d.toISOString().slice(0, 10);
                                            }
                                            setFormData({
                                                ...formData,
                                                plan_id: value,
                                                build_credits: nextCredits,
                                                plan_expires_at: value === 'none' ? '' : nextExpiry,
                                            });
                                        }}
                                    >
                                        <SelectTrigger id="edit-plan">
                                            <SelectValue placeholder={t('Select plan')} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">{t('Free / Default Plan')}</SelectItem>
                                            {plans.map((p) => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    {p.name} (${p.price}/{p.billing_period})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="edit-expiry" className="flex items-center gap-1.5">
                                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                        {t('Plan Expiration Date')}
                                    </Label>
                                    <Input
                                        id="edit-expiry"
                                        type="date"
                                        value={formData.plan_expires_at}
                                        onChange={(e) =>
                                            setFormData({ ...formData, plan_expires_at: e.target.value })
                                        }
                                    />
                                    <div className="flex flex-wrap gap-1 pt-0.5">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-6 px-2 text-[11px]"
                                            onClick={() => {
                                                const d = new Date();
                                                d.setDate(d.getDate() + 30);
                                                setFormData({
                                                    ...formData,
                                                    plan_expires_at: d.toISOString().slice(0, 10),
                                                });
                                            }}
                                        >
                                            +30d
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-6 px-2 text-[11px]"
                                            onClick={() => {
                                                const d = new Date();
                                                d.setFullYear(d.getFullYear() + 1);
                                                setFormData({
                                                    ...formData,
                                                    plan_expires_at: d.toISOString().slice(0, 10),
                                                });
                                            }}
                                        >
                                            +1yr
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2 text-[11px]"
                                            onClick={() =>
                                                setFormData({ ...formData, plan_expires_at: '' })
                                            }
                                        >
                                            {t('Clear')}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="edit-credits" className="flex items-center gap-1.5">
                                    <Coins className="h-3.5 w-3.5 text-muted-foreground" />
                                    {t('Build Credits Balance (Tokens)')}
                                </Label>
                                <Input
                                    id="edit-credits"
                                    type="number"
                                    min={0}
                                    step={10000}
                                    value={formData.build_credits}
                                    onChange={(e) =>
                                        setFormData({ ...formData, build_credits: e.target.value })
                                    }
                                    className="font-mono"
                                />
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    <span className="text-xs text-muted-foreground me-1">
                                        {t('Quick Adjust:')}
                                    </span>
                                    {[
                                        { label: '+50K', delta: 50_000 },
                                        { label: '+100K', delta: 100_000 },
                                        { label: '+500K', delta: 500_000 },
                                        { label: '+1M', delta: 1_000_000 },
                                        { label: '+5M', delta: 5_000_000 },
                                    ].map((btn) => (
                                        <Button
                                            key={btn.label}
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-6 px-2 text-[11px]"
                                            onClick={() =>
                                                setFormData({
                                                    ...formData,
                                                    build_credits: String(
                                                        Math.max(
                                                            0,
                                                            Number(formData.build_credits || 0) + btn.delta
                                                        )
                                                    ),
                                                })
                                            }
                                        >
                                            {btn.label}
                                        </Button>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-[11px]"
                                        onClick={() => {
                                            const matched = plans.find((p) => p.id === formData.plan_id);
                                            setFormData({
                                                ...formData,
                                                build_credits: String(
                                                    matched && matched.monthly_build_credits >= 0
                                                        ? matched.monthly_build_credits
                                                        : 0
                                                ),
                                            });
                                        }}
                                    >
                                        {t('Reset to Plan')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                            {t('Cancel')}
                        </Button>
                        <Button onClick={handleEdit}>{t('Save Changes')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => {
                setIsDeleteDialogOpen(open);
                if (!open) setUserToDelete(null);
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('Are you sure you want to delete this user?')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('This action cannot be undone. This will permanently delete the user account and all associated data.')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className={buttonVariants({ variant: 'destructive' })}
                        >
                            {t('Delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </AdminLayout>
    );
}
