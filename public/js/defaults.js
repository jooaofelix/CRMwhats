/** Constantes de dominio e valores padrao de um novo workspace. */

/**
 * Etapas do funil. Sao gravadas em companies/{id}/settings/pipeline na criacao
 * do workspace, e a partir dai podem ser renomeadas/reordenadas nas
 * Configuracoes — por isso todo o app le as etapas do estado, nunca daqui.
 *
 * `won` / `lost` marcam as etapas terminais: e o que os relatorios usam para
 * calcular conversao, mesmo que o cliente renomeie as etapas.
 */
export const DEFAULT_STAGES = [
  { id: 'novo',       name: 'Novo lead',          color: '#6366f1' },
  { id: 'contato',    name: 'Contato realizado',  color: '#0ea5e9' },
  { id: 'negociacao', name: 'Em negociação',      color: '#8b5cf6' },
  { id: 'proposta',   name: 'Proposta enviada',   color: '#f59e0b' },
  { id: 'aguardando', name: 'Aguardando cliente', color: '#fb7185' },
  { id: 'fechado',    name: 'Fechado',            color: '#10b981', won: true },
  { id: 'perdido',    name: 'Perdido',            color: '#94a3b8', lost: true }
];

export const DEFAULT_SOURCES = [
  'WhatsApp', 'Instagram', 'Google', 'Site', 'Indicação', 'Cliente antigo', 'Anúncio', 'Outro'
];

export const DEFAULT_TAGS = ['QUENTE', 'MORNO', 'FRIO', 'INDICAÇÃO', 'CLIENTE ANTIGO', 'VIP', 'URGENTE'];

export const DEFAULT_LOST_REASONS = [
  'Preço', 'Sem resposta', 'Escolheu concorrente', 'Fora do perfil', 'Sem orçamento agora', 'Outro'
];

/** Tipos de interacao da timeline. `system` e gerado pelo proprio CRM. */
export const INTERACTION_TYPES = [
  { id: 'anotacao', label: 'Anotação',  icon: 'note' },
  { id: 'ligacao',  label: 'Ligação',   icon: 'phone' },
  { id: 'mensagem', label: 'Mensagem',  icon: 'whatsapp' },
  { id: 'reuniao',  label: 'Reunião',   icon: 'calendar' },
  { id: 'proposta', label: 'Proposta',  icon: 'money' },
  { id: 'followup', label: 'Follow-up', icon: 'clock' },
  { id: 'tarefa',   label: 'Tarefa',    icon: 'check' }
];

export const TASK_PRIORITIES = [
  { id: 'baixa', label: 'Baixa' },
  { id: 'media', label: 'Média' },
  { id: 'alta',  label: 'Alta' }
];

export const TASK_STATUS = { OPEN: 'aberta', DONE: 'concluida', CANCELED: 'cancelada' };

export const CONTACT_STATUS = { OPEN: 'aberto', WON: 'ganho', LOST: 'perdido' };

export const ROLES = {
  ADMIN: 'admin',
  SALES: 'vendedor'
};

export const ROLE_LABEL = {
  admin: 'Administrador',
  vendedor: 'Vendedor'
};

/**
 * Planos previstos para o SaaS. Nada e cobrado nesta versao — a estrutura
 * existe para que o gateway de pagamento seja plugado depois sem migracao.
 */
export const PLANS = {
  trial:    { id: 'trial',    label: 'Trial',    seats: 2,   contacts: 200 },
  solo:     { id: 'solo',     label: 'Solo',     seats: 1,   contacts: 1000 },
  pro:      { id: 'pro',      label: 'Pro',      seats: 5,   contacts: 10000 },
  business: { id: 'business', label: 'Business', seats: 25,  contacts: 100000 }
};

/** Variaveis aceitas nos modelos de mensagem. */
export const TEMPLATE_VARS = [
  { key: 'nome',        desc: 'Primeiro nome do contato' },
  { key: 'nome_completo', desc: 'Nome completo do contato' },
  { key: 'empresa',     desc: 'Empresa do contato' },
  { key: 'responsavel', desc: 'Responsável pelo contato' },
  { key: 'valor',       desc: 'Valor da negociação' },
  { key: 'etapa',       desc: 'Etapa atual no funil' },
  { key: 'data',        desc: 'Data de hoje' },
  { key: 'link',        desc: 'Link configurado nas configurações' }
];

/** Modelos criados junto com o workspace, para o usuario ter algo pronto. */
export const SEED_TEMPLATES = [
  {
    name: 'Primeiro contato',
    category: 'Prospecção',
    body: 'Olá {{nome}}, tudo bem? Aqui é o {{responsavel}}. Vi seu contato e queria entender melhor o que você precisa. Posso te ajudar?'
  },
  {
    name: 'Envio de proposta',
    category: 'Proposta',
    body: 'Oi {{nome}}! Segue a proposta que preparei para a {{empresa}}, no valor de {{valor}}. Qualquer dúvida me chama por aqui.'
  },
  {
    name: 'Follow-up de proposta',
    category: 'Follow-up',
    body: 'Olá {{nome}}, tudo bem? Conseguiu analisar a proposta que te enviei? Fico à disposição para ajustar o que for necessário.'
  },
  {
    name: 'Reativação de contato parado',
    category: 'Follow-up',
    body: 'Oi {{nome}}, tudo certo? Faz um tempo que não conversamos. Ainda faz sentido retomarmos aquele assunto?'
  },
  {
    name: 'Pós-venda',
    category: 'Pós-venda',
    body: 'Olá {{nome}}! Passando para saber como foi sua experiência com a gente. Sua opinião ajuda muito!'
  }
];

/** Atalhos de follow-up oferecidos na interface. */
export const FOLLOWUP_PRESETS = [
  { id: 'amanha', label: 'Amanhã',   days: 1 },
  { id: 'd2',     label: 'Em 2 dias', days: 2 },
  { id: 'd3',     label: 'Em 3 dias', days: 3 },
  { id: 'd7',     label: 'Em 7 dias', days: 7 },
  { id: 'd15',    label: 'Em 15 dias', days: 15 },
  { id: 'custom', label: 'Escolher data', days: null }
];

/** Configuracoes padrao do workspace. */
export function defaultSettings() {
  return {
    stages: DEFAULT_STAGES.map((s, i) => ({ ...s, order: i })),
    sources: [...DEFAULT_SOURCES],
    tags: [...DEFAULT_TAGS],
    lostReasons: [...DEFAULT_LOST_REASONS],
    staleDays: 5,
    followUpDefaultHour: 9,
    defaultLink: '',
    whatsapp: {
      // Somente identificadores nao sensiveis. O token da Meta e o app secret
      // ficam apenas nas secrets do Cloudflare Worker.
      enabled: false,
      phoneNumberId: '',
      displayNumber: '',
      wabaId: ''
    }
  };
}
