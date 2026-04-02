export interface RoleAvatar {
  id: string
  label: string
  url: string
}

export const ROLE_AVATARS: RoleAvatar[] = [
  { id: 'ceo',                  label: 'CEO',     url: '/avatars/role-ceo.webp' },
  { id: 'cto',                  label: 'CTO',     url: '/avatars/role-cto.webp' },
  { id: 'cfo',                  label: 'CFO',     url: '/avatars/role-cfo.webp' },
  { id: 'coo',                  label: 'COO',     url: '/avatars/role-coo.webp' },
  { id: 'product-manager',      label: '产品经理',  url: '/avatars/role-product-manager.webp' },
  { id: 'engineer',             label: '工程师',   url: '/avatars/role-engineer.webp' },
  { id: 'designer',             label: '设计师',   url: '/avatars/role-designer.webp' },
  { id: 'data-analyst',         label: '数据分析师', url: '/avatars/role-data-analyst.webp' },
  { id: 'sales-director',       label: '销售总监',  url: '/avatars/role-sales-director.webp' },
  { id: 'sales-rep',            label: '销售专员',  url: '/avatars/role-sales-rep.webp' },
  { id: 'marketing-manager',    label: '市场经理',  url: '/avatars/role-marketing-manager.webp' },
  { id: 'marketing-specialist', label: '市场专员',  url: '/avatars/role-marketing-specialist.webp' },
  { id: 'cs-manager',           label: '客服经理',  url: '/avatars/role-cs-manager.webp' },
  { id: 'customer-service',     label: '客服专员',  url: '/avatars/role-customer-service.webp' },
  { id: 'hr-manager',           label: 'HR 经理',  url: '/avatars/role-hr-manager.webp' },
  { id: 'finance-analyst',      label: '财务分析师', url: '/avatars/role-finance-analyst.webp' },
]
