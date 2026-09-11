// Every selector that tracks Asana's internal class names lives here. Asana
// exposes no JSON endpoint for a rule, so the extension reads the rendered
// dialog; when Asana ships a UI change, this is the file that needs updating.
export const SEL = {
  // Rule dialog
  dialog: ".AutomationDialogStructure",
  containerName: ".AutomationDialogHeaderWithEditableTitle-containerName",
  ruleName: 'input[data-testid="EditableTitle"]',
  status: ".AutomationStatusToggleMenu-subtleButton",
  lastRun: '[data-testid="ExecutedTime"]',
  closeDialog: '[aria-label="Close this dialog"]',
  saveButton: ".EditAutomationDialogConfigurationPage-submitButton",
  placeholderPill: ".AutomationConfigurationContentPlaceholderPill",

  // Flowchart
  multiCard: ".AutomationDialogMultiConfigurationCanvasCard",
  multiCardHeader: ".AutomationDialogMultiConfigurationCanvasCard-headerText",
  evaluationType: ".AutomationDialogMultiConfigurationCanvasCard-evaluationType",
  card: ".AutomationDialogConfigurationCardStructure",
  cardKind: ".AutomationDialogConfigurationCardStructure-configurationObjectTitle",
  cardTitle: ".AutomationDialogConfigurationCardStructure-title",
  facepile: ".DomainUsersAutomationConfigurationContent-facepile",
  people:
    ".DomainUsersAutomationConfigurationContent-facepile, .DomainUsersAutomationConfigurationContent-avatarAndName",
  personName: ".DomainUsersAutomationConfigurationContent-avatarAndName span",
  countAvatar: '[data-testid="count-avatar"]',
  avatarImage: "image[href], img[src]",

  // Side pane (opens when a card is clicked)
  pane: ".AutomationDialogPaneManager",
  panePill: '[class*="PillThemeablePresentation"]',
  paneClose:
    '[aria-label*="Close" i], [aria-label*="Collapse" i], [aria-label*="Hide" i], [aria-label*="Dismiss" i]',
  canvasScroller: ".AutomationConfigurationCanvas-scrollable",

  // "Use AI" in place of a concrete object: the AI picks the value at run time
  // from the rule's Instructions (the floating "Instructions" card on the canvas).
  useAiPill: ".UseAiPill",
  aiGuidanceButton: ".AutomationCanvasFloatingToolbar-aiGuidanceButton",
  aiGuidanceCard: ".AutomationCanvasAiGuidanceFloatingCard",
  aiGuidanceEditor: ".AutomationCanvasAiGuidanceFloatingCard-textEditor .ProseMirror",
  aiGuidanceTab: ".AutomationCanvasAiGuidanceFloatingToolbarButton--tab",
  aiGuidanceMinimize: '.AutomationCanvasAiGuidanceFloatingCard [aria-label="Minimize"]',
  /** Project/task pill embedded in rich text; carries the object gid. */
  objectPill: "[data-asana-object][data-object-id]",

  // Value pills inside a card title
  fieldPill: ".AutomationFieldPill",
  fieldPillLabel: '[data-testid="automationFieldPillPublic"]',
  valuePills:
    ".AutomationConfigurationContentPills, .CustomPropertyEnumsAutomationConfigurationContent",
  pill: '[class*="PillThemeablePresentation"]',

  // Customize pane -> Rules list
  customizeButton: ".CustomizeMenuButton",
  customizeHome: ".CustomizeGalleryHomePage-content",
  drilldownRow: ".CustomizePaneDrilldownRow-buttonCard",
  ruleRow: ".CustomizeGalleryRulesPage-combinedItemRow",
  ruleRowName: "h6",
} as const;
