import type { Match, MatchMail } from "@/types/email";
import { normalizeSubject } from "@/lib/email/normalize";
const generic =
  /^(solicitud|consulta|informaci[oó]n|requerimiento|soporte|sin asunto|\(sin asunto\))$/i;
function topic(subject: string) {
  // A topic alone never suffices: participants and chronology are mandatory.
  return normalizeSubject(subject).replace(
    /^(?:respuesta|solicitud)\s+(?:de|del|a|al|sobre|para)\s+/i,
    "",
  );
}
export function matchEmails(mails: MatchMail[]): Map<string, Match> {
  const byKey = new Map(mails.map((m) => [m.key, m]));
  const byId = new Map(
    mails.filter((m) => m.messageId).map((m) => [m.messageId!, m]),
  );
  const bySubject = new Map<string, MatchMail[]>();
  for (const m of mails) {
    const subject = topic(m.subject);
    const group = bySubject.get(subject) ?? [];
    group.push(m);
    bySubject.set(subject, group);
  }
  const results = new Map<string, Match>(),
    visiting = new Set<string>();
  const review = (reason: string, candidates: string[] = []): Match => ({
    kind: "REVIEW",
    rootKey: null,
    reason,
    candidates,
  });
  function resolve(mail: MatchMail): Match {
    if (results.has(mail.key)) return results.get(mail.key)!;
    if (visiting.has(mail.key)) return review("Referencias cíclicas");
    visiting.add(mail.key);
    const initial = (): Match => ({
      kind: mail.staffName ? "STAFF_SENT" : "REQUEST",
      rootKey: mail.key,
      reason: mail.staffName
        ? "Personal configurado: sin solicitud compatible; correo iniciado por personal"
        : "Solicitud externa dirigida al buzón",
      candidates: [],
    });
    const unlinked = (): Match => ({
      kind: "RESPONSE",
      rootKey: null,
      reason: "Respuesta del personal sin asociación · clasificación manual",
      candidates: [],
    });
    const link = (target: MatchMail): Match => {
      if (target.key === mail.key)
        return review("Un correo no puede asociarse consigo mismo");
      const parent = resolve(target),
        root = parent.rootKey ? byKey.get(parent.rootKey) : undefined;
      if (
        !root ||
        root.key === mail.key ||
        Date.parse(mail.date) <= Date.parse(root.date) ||
        Date.parse(mail.date) < Date.parse(target.date)
      )
        return review("La relación no tiene una solicitud anterior válida", [
          target.key,
        ]);
      if (
        mail.staffName &&
        root.decision?.excludedResponseKeys?.includes(mail.key)
      )
        return review(
          "Esta asociación se excluyó al marcar la solicitud como no respondida",
          [root.key],
        );
      return {
        kind:
          mail.staffName && resolve(root).kind === "REQUEST"
            ? "RESPONSE"
            : "FOLLOWUP",
        rootKey: root.key,
        reason: "Cabeceras de conversación verificadas",
        candidates: [],
        dependencies: [
          ...new Set([target.key, root.key, ...(parent.dependencies ?? [])]),
        ],
      };
    };
    const infer = (manualResponse = false): Match => {
      if (!mail.addressed && !manualResponse)
        return review("El buzón configurado no figura en Para ni CC");
      const direct = [...new Set(mail.inReplyTo)]
        .map((id) => byId.get(id))
        .filter((m): m is MatchMail => !!m);
      const refs = [...mail.references]
        .reverse()
        .map((id) => byId.get(id))
        .filter((m): m is MatchMail => !!m);
      if (direct.length > 1) {
        const links = direct.map(link),
          roots = new Set(links.map((m) => m.rootKey));
        if (roots.size === 1 && links.every((m) => m.kind !== "REVIEW"))
          return links[0];
        return manualResponse
          ? unlinked()
          : review(
              "Varias referencias directas contradictorias",
              direct.map((m) => m.key),
            );
      }
      if (direct[0] || refs[0]) {
        const found = link(direct[0] ?? refs[0]);
        return manualResponse && found.kind === "REVIEW" ? unlinked() : found;
      }
      const isReply =
        mail.inReplyTo.length > 0 ||
        mail.references.length > 0 ||
        /^(\s*(?:re|rv|fw|fwd|respuesta|reenviar)(?:\[\d+\])?\s*:)/i.test(
          mail.subject,
        );
      if (!isReply && !mail.staffName) return initial();
      const participants = new Set(
        [...mail.to, ...mail.cc].map((a) => a.address),
      );
      const subject = topic(mail.subject);
      // All history is searched; specific unique roots have no arbitrary age cutoff.
      const possible = (bySubject.get(subject) ?? []).filter(
        (m) =>
          m.key !== mail.key &&
          !m.staffName &&
          Date.parse(m.date) < Date.parse(mail.date) &&
          (participants.has(m.from.address) ||
            m.from.address === mail.from.address),
      );
      const roots = [
        ...new Set(
          possible
            .map((m) => resolve(m).rootKey)
            .filter((key): key is string => !!key),
        ),
      ]
        .map((key) => byKey.get(key)!)
        .filter((m) => resolve(m).kind === "REQUEST");
      const eligible = roots.filter(
        (m) =>
          !generic.test(subject) ||
          Date.parse(mail.date) - Date.parse(m.date) <= 86400000,
      );
      if (
        eligible.length === 1 &&
        subject &&
        !/^(sin asunto|\(sin asunto\))$/i.test(subject)
      ) {
        const found = link(eligible[0]);
        if (found.kind !== "REVIEW")
          found.reason =
            "Asociada automáticamente: asunto, participantes, buzón y cronología compatibles; una sola solicitud candidata en importación e histórico";
        return manualResponse && found.kind === "REVIEW" ? unlinked() : found;
      }
      if (manualResponse) return unlinked();
      if (mail.staffName && !roots.length) return initial();
      return review(
        roots.length > 1
          ? "Varias solicitudes compatibles: selecciona el original"
          : "No hay una solicitud anterior con suficiente contexto",
        roots.map((m) => m.key).slice(0, 20),
      );
    };
    let match: Match;
    // Approvals retain their decisions; explicitly unlinked replies can reconcile later.
    if (
      mail.approvedKind &&
      !(
        mail.approvedKind === "RESPONSE" &&
        !mail.approvedRootKey &&
        !mail.decision?.targetKey
      )
    ) {
      if (mail.approvedKind === "REQUEST" || mail.approvedKind === "STAFF_SENT")
        match = {
          ...initial(),
          kind: mail.approvedKind,
          reason: "Clasificación histórica aprobada",
        };
      else if (mail.approvedRootKey) {
        const root = byKey.get(mail.approvedRootKey);
        match = root
          ? link(root)
          : review("La solicitud histórica asociada ya no está disponible");
      } else
        match = review(
          "Clasificación histórica pendiente de corrección manual",
        );
    } else if (mail.decision) {
      const d = mail.decision;
      if (d.kind === "REQUEST" || d.kind === "STAFF_SENT")
        match =
          (d.kind === "STAFF_SENT") !== Boolean(mail.staffName)
            ? review("Clasificación incompatible con el remitente")
            : { ...initial(), kind: d.kind, reason: "Clasificación manual" };
      else if (d.kind === "RESPONSE" && !d.targetKey)
        match = mail.staffName
          ? infer(true)
          : review(
              "Solo el personal configurado puede emitir una respuesta del personal",
            );
      else {
        const target = d.targetKey ? byKey.get(d.targetKey) : undefined;
        if (target?.key === mail.key)
          match = review("Un correo no puede asociarse consigo mismo");
        else if (!target)
          match = review("La solicitud original asociada no está disponible");
        else if (
          resolve(target).kind !== "REQUEST" &&
          !(d.kind === "FOLLOWUP" && resolve(target).kind === "STAFF_SENT")
        )
          match = review(
            "Selecciona una solicitud original; otra respuesta no es un original válido",
          );
        else {
          match = link(target);
          if (match.kind !== d.kind)
            match = review(
              "La relación manual no cumple las reglas de remitente y cronología",
            );
          else match.reason = "Asociación manual verificada";
        }
      }
    } else match = infer(mail.approvedKind === "RESPONSE");
    visiting.delete(mail.key);
    results.set(mail.key, match);
    return match;
  }
  for (const mail of [...mails].sort(
    (a, b) =>
      Date.parse(a.date) - Date.parse(b.date) || a.key.localeCompare(b.key),
  ))
    resolve(mail);
  return results;
}
