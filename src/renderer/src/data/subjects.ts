export interface Subject {
  id: string
  name: string
  shortName: string
  level: '高级' | '中级' | '初级'
  color: string
}

/** 常见软考科目 */
export const SUBJECTS: Subject[] = [
  { id: 'architect', name: '系统架构设计师', shortName: '架构', level: '高级', color: '#0f766e' },
  { id: 'pm', name: '信息系统项目管理师', shortName: '高项', level: '高级', color: '#1d4ed8' },
  { id: 'analyst', name: '系统分析师', shortName: '分析', level: '高级', color: '#7c2d12' },
  { id: 'network-planner', name: '网络规划设计师', shortName: '网规', level: '高级', color: '#4338ca' },
  { id: 'se', name: '软件设计师', shortName: '软设', level: '中级', color: '#047857' },
  { id: 'network', name: '网络工程师', shortName: '网工', level: '中级', color: '#0369a1' },
  { id: 'db', name: '数据库系统工程师', shortName: '库工', level: '中级', color: '#a16207' },
  { id: 'info-security', name: '信息安全工程师', shortName: '安工', level: '中级', color: '#be123c' },
  { id: 'media', name: '多媒体应用设计师', shortName: '多媒', level: '中级', color: '#c2410c' },
  { id: 'programmer', name: '程序员', shortName: '程序', level: '初级', color: '#475569' },
  { id: 'network-admin', name: '网络管理员', shortName: '网管', level: '初级', color: '#64748b' },
]

export function getSubject(id: string): Subject {
  return SUBJECTS.find((s) => s.id === id) || SUBJECTS[0]
}
