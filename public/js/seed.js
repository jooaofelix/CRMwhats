/**
 * Dados de demonstracao.
 *
 * Sao registros reais, gravados no Firestore como qualquer outro — servem para
 * experimentar o fluxo completo (funil, follow-up, timeline) e podem ser
 * editados ou excluidos normalmente. Nada aqui substitui a persistencia real.
 */

import { state, stages } from './state.js';
import { createContact, addInteraction, scheduleFollowUp, createTask, moveContactStage } from './data.js';
import { addDays } from './utils.js';

const DEMO = [
  {
    name: 'João Silva', company: 'Empresa XPTO', whatsapp: '(12) 98888-1010',
    email: 'joao@xpto.com.br', source: 'WhatsApp', value: 2500, stage: 'proposta',
    tags: ['QUENTE', 'INDICAÇÃO'], nextAction: 'Confirmar se analisou a proposta',
    notes: 'Pediu proposta para 3 unidades. Decide junto com o sócio.',
    followUpInDays: 1, lastTouchDaysAgo: 0,
    timeline: [
      { type: 'ligacao', title: 'Primeiro contato por telefone', days: 4 },
      { type: 'mensagem', title: 'Enviou detalhes pelo WhatsApp', days: 3 },
      { type: 'proposta', title: 'Proposta enviada', body: 'R$ 2.500 — validade de 15 dias', days: 1 }
    ]
  },
  {
    name: 'Maria Souza', company: 'Souza Consultoria', whatsapp: '(12) 97777-2020',
    email: 'maria@souzaconsult.com.br', source: 'Instagram', value: 1800, stage: 'aguardando',
    tags: ['MORNO'], nextAction: 'Retornar após reunião interna dela',
    notes: 'Pediu para retornar na sexta-feira.',
    followUpInDays: 2, lastTouchDaysAgo: 2,
    timeline: [
      { type: 'mensagem', title: 'Veio pelo direct do Instagram', days: 8 },
      { type: 'reuniao', title: 'Reunião de apresentação', body: 'Gostou do escopo, vai levar ao time.', days: 5 },
      { type: 'proposta', title: 'Proposta enviada', days: 3 }
    ]
  },
  {
    name: 'Carlos Lima', company: 'Lima Serviços', whatsapp: '(12) 96666-3030',
    source: 'Indicação', value: 4200, stage: 'novo',
    tags: ['QUENTE'], nextAction: 'Fazer o primeiro contato',
    notes: 'Indicado pelo cliente João Silva.',
    followUpInDays: 0, lastTouchDaysAgo: null,
    timeline: []
  },
  {
    name: 'Mariana Costa', company: 'Ateliê Costa', whatsapp: '(12) 95555-4040',
    email: 'contato@ateliecosta.com.br', source: 'Google', value: 900, stage: 'negociacao',
    tags: ['MORNO'], nextAction: 'Ajustar escopo e reenviar',
    notes: 'Achou o valor alto, pediu opção reduzida.',
    followUpInDays: null, lastTouchDaysAgo: 8,
    timeline: [
      { type: 'ligacao', title: 'Ligação de qualificação', days: 12 },
      { type: 'anotacao', title: 'Achou o valor alto', body: 'Pediu uma versão mais enxuta do serviço.', days: 8 }
    ]
  },
  {
    name: 'Pedro Almeida', company: 'PA Reformas', whatsapp: '(12) 94444-5050',
    source: 'Anúncio', value: 6800, stage: 'contato',
    tags: ['VIP'], nextAction: 'Agendar visita técnica',
    notes: 'Obra grande, prazo para começar em 30 dias.',
    followUpInDays: 3, lastTouchDaysAgo: 1,
    timeline: [{ type: 'mensagem', title: 'Respondeu ao anúncio', days: 1 }]
  },
  {
    name: 'Ana Oliveira', company: 'Clínica Vida', whatsapp: '(12) 93333-6060',
    email: 'ana@clinicavida.com.br', source: 'Site', value: 3200, stage: 'fechado',
    tags: ['CLIENTE ANTIGO'], nextAction: 'Acompanhar pós-venda',
    notes: 'Renovação de contrato anual.',
    followUpInDays: null, lastTouchDaysAgo: 3, won: true,
    timeline: [
      { type: 'reuniao', title: 'Reunião de renovação', days: 10 },
      { type: 'proposta', title: 'Proposta de renovação enviada', days: 7 }
    ]
  },
  {
    name: 'Rafael Nunes', company: 'Nunes Transportes', whatsapp: '(12) 92222-7070',
    source: 'Cliente antigo', value: 1500, stage: 'perdido',
    tags: ['FRIO'], nextAction: '', notes: 'Fechou com concorrente por preço.',
    followUpInDays: null, lastTouchDaysAgo: 15, lost: true, lostReason: 'Escolheu concorrente',
    timeline: [{ type: 'ligacao', title: 'Retorno do cliente', body: 'Optou por outro fornecedor.', days: 15 }]
  }
];

const EXTRA_TASKS = [
  { title: 'Enviar orçamento revisado para Mariana', days: 0, priority: 'alta' },
  { title: 'Cobrar documentação da Clínica Vida', days: 1, priority: 'media' },
  { title: 'Ligar para Carlos Lima', days: -2, priority: 'alta' }
];

/** Mapeia o id de etapa do exemplo para uma etapa que exista no workspace. */
function resolveStage(stageId) {
  const list = stages();
  return list.find((s) => s.id === stageId)?.id || list[0]?.id;
}

/**
 * Cria os registros de demonstracao.
 * @returns {Promise<number>} quantidade de registros criados
 */
export async function seedDemoData() {
  if (!state.company) throw new Error('Nenhum workspace ativo.');

  let created = 0;
  const byName = new Map();

  for (const demo of DEMO) {
    const targetStage = resolveStage(demo.stage);
    const isTerminal = demo.won || demo.lost;

    // Contatos que terminam em ganho/perda entram numa etapa aberta e sao
    // movidos depois, para a timeline registrar a mudanca como no uso real.
    const contactId = await createContact({
      name: demo.name,
      company: demo.company,
      whatsapp: demo.whatsapp,
      phone: demo.whatsapp,
      email: demo.email || '',
      source: demo.source,
      value: demo.value,
      stage: isTerminal ? resolveStage('proposta') : targetStage,
      tags: demo.tags,
      notes: demo.notes,
      nextAction: demo.nextAction,
      ownerId: state.user.uid,
      ownerName: state.member?.name || ''
    });
    created++;
    byName.set(demo.name, contactId);

    for (const item of demo.timeline) {
      await addInteraction(contactId, {
        type: item.type,
        title: item.title,
        body: item.body || '',
        at: addDays(new Date(), -item.days)
      }, { touch: false });
      created++;
    }

    if (demo.lastTouchDaysAgo !== null && demo.lastTouchDaysAgo !== undefined) {
      const { updateContact } = await import('./data.js');
      await updateContact(contactId, { lastContactAt: addDays(new Date(), -demo.lastTouchDaysAgo) });
    }

    if (isTerminal) {
      await moveContactStage(contactId, targetStage, { lostReason: demo.lostReason || '' });
      created++;
    }

    if (demo.followUpInDays !== null && demo.followUpInDays !== undefined) {
      const when = addDays(new Date(), demo.followUpInDays);
      when.setHours(demo.followUpInDays === 0 ? new Date().getHours() + 1 : 10, 0, 0, 0);
      await scheduleFollowUp(contactId, when, { note: demo.nextAction || 'Follow-up' });
      created++;
    }
  }

  for (const task of EXTRA_TASKS) {
    const due = addDays(new Date(), task.days);
    due.setHours(14, 0, 0, 0);
    await createTask({ title: task.title, dueAt: due, priority: task.priority });
    created++;
  }

  return created;
}
