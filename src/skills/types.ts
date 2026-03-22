export interface SkillMetadata {
  name: string;
  description: string;
  directoryPath: string;
  skillFilePath: string;
}

export interface SkillSearchCandidate {
  title: string;
}

export interface SkillSearchResult {
  query: string;
  candidates: SkillSearchCandidate[];
  rawOutput: string;
}

export interface PendingSkillInstallRequest {
  id: string;
  source: string;
  requestedSkills: string[];
  reason: string;
  goal: string;
  createdAt: string;
}

export interface SkillInstallResult {
  userId: string;
  source: string;
  requestedSkills: string[];
  installedSkills: SkillMetadata[];
  stdout: string;
  stderr: string;
  installDirectory: string;
}
