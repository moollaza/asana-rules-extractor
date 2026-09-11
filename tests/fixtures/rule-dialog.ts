// Synthetic Asana rule dialog mirroring the real class structure. Names and
// gids are invented; nothing here comes from a real workspace.

const pill = (text: string) => `<span class="PillThemeablePresentation_abc_root">${text}</span>`;
const fieldPill = (text: string) =>
  `<span class="AutomationFieldPill"><span class="PillThemeablePresentation_abc_root"><span data-testid="automationFieldPillPublic">${text}</span></span></span>`;
const avatar = (userGid: string) =>
  `<svg><image href="https://s3.amazonaws.com/x/assets/137000000000/profile_photos/1/${userGid}.9990000000.abc_27x27.png"/></svg>`;
const plainAvatar = (userGid: string) =>
  `<svg><image href="https://s3.amazonaws.com/x/assets/137000000000/profile_photos/${userGid}/c0371e689c374079b770da58b64a8bbe_27x27.png?e=1&amp;v=0"/></svg>`;

export function card(kind: string | null, title: string, extra = ""): string {
  return `<div class="AutomationDialogConfigurationCardStructure">
    ${kind ? `<div class="AutomationDialogConfigurationCardStructure-configurationObjectTitle">${kind}</div>` : ""}
    <div class="AutomationDialogConfigurationCardStructure-cardTitle">
      <span class="AutomationDialogConfigurationCardStructure-title">${title}${extra}</span>
    </div></div>`;
}

export function multiCard(header: string, joiner: string, cards: string[]): string {
  return `<div class="AutomationDialogMultiConfigurationCanvasCard">
    <div class="AutomationDialogMultiConfigurationCanvasCard-headerText">${header}</div>
    <div class="AutomationDialogMultiConfigurationCanvasCard-evaluationType">${joiner}</div>
    ${cards.join("")}</div>`;
}

const useAiPill = `<div class="UseAiPill"><div class="AutomationConfigurationContentColorlessPill"><div class="PillThemeablePresentation_abc_root UseAiPill-pill"><svg><path/></svg><span class="UseAiPill-pillText">Use AI</span></div></div></div>`;
const objectPill = (gid: string, name: string) =>
  `<span data-asana-object="1" data-object-id="${gid}" contenteditable="false"><span class="WorkGraphObjectPill WorkGraphObjectPill--project WorkGraphObjectPill--medium"><span class="WorkGraphObjectPill-iconContainer"><svg><title>icon</title></svg></span><a href="https://app.asana.com/1/1/project/${gid}/list">${name}</a></span></span>`;

export const instructionsEditor = `<div class="AutomationCanvasAiGuidanceFloatingCard"><div class="AutomationCanvasAiGuidanceFloatingCard-textEditor"><div class="ProseMirror" contenteditable="true">
  <p>When Area is "Static":</p>
  <p><br></p>
  <p>Determine if </p>
  <ol><li data-list-indent="1"><p>the task is about our ${objectPill("1116104605880867", "Help Pages")} project and add it there</p></li>
  <li data-list-indent="1"><p>Otherwise add to  ${objectPill("424903000459", "Homepage and Static Marketing Pages")}<img class="ProseMirror-separator" alt=""><br></p>
    <ul><li data-list-indent="2"><p>nested note</p></li></ul></li></ol>
</div></div></div>`;

export const cards = {
  trigger: card("When", "Task is added to this project"),
  fieldChanged: card(null, `${fieldPill("Area")} is changed`),
  enumCondition: card(
    "Check if",
    `${fieldPill("Area")} is set to <span class="AutomationConfigurationContentPills">${pill("Billing")}</span>`,
  ),
  truncated: card(
    "Otherwise if",
    `${fieldPill("Area")} is one of <span class="AutomationConfigurationContentPills">${pill("Alpha")}<span>+25</span></span>`,
  ),
  moveToSection: card(
    "Do this",
    `Move task to section <span class="AutomationConfigurationContentPills">${pill("Search")}</span>`,
  ),
  setTaskName: card("Do this", `Set task name to "⭐ Report: ${pill("Task name")}"`),
  onePerson: card(
    "Do this",
    "Add collaborators",
    `<div class="DomainUsersAutomationConfigurationContent-avatarAndName">${avatar("1200000000000001")}<span>Ada Lovelace</span></div>`,
  ),
  onePersonPlainUrl: card(
    "Do this",
    "Add collaborators",
    `<div class="DomainUsersAutomationConfigurationContent-avatarAndName">${plainAvatar("1200000000000009")}<span>Grace Hopper</span></div>`,
  ),
  threePeople: card(
    "Do this",
    "Add collaborators",
    `<div class="DomainUsersAutomationConfigurationContent-facepile">${avatar("1200000000000002")}${avatar("1200000000000003")}<span data-testid="count-avatar">3</span></div>`,
  ),
  unknownAction: card("Do this", "Frobnicate the widget"),
  useAiProject: card("Do this", `Add to an additional project ${useAiPill}`),
  otherwise: card("Otherwise", ""),
  otherwiseNoTitle: `<div class="AutomationDialogConfigurationCardStructure"><div class="AutomationDialogConfigurationCardStructure-configurationObjectTitle">Otherwise</div></div>`,
  placeholder: card(
    "Do this",
    'Move task to section <div class="AutomationConfigurationContentPlaceholderPill"><span>Unspecified</span></div>',
  ),
};

export function dialog(body: string, { dirty = false, name = "Test Rule" } = {}): string {
  return `<div class="AutomationDialogStructure">
    <div class="AutomationDialogHeaderWithEditableTitle-containerName">Fixture Project</div>
    <input data-testid="EditableTitle" value="${name}" />
    <div class="AutomationStatusToggleMenu-subtleButton">Active</div>
    <span data-testid="ExecutedTime">Last run yesterday</span>
    ${body}
    <div role="button" class="EditAutomationDialogConfigurationPage-submitButton" aria-disabled="${!dirty}">Save</div>
    <div class="AutomationDialogPaneManager"></div>
  </div>`;
}

export function mount(html: string): Element {
  document.body.innerHTML = html;
  return document.querySelector(".AutomationDialogStructure")!;
}
