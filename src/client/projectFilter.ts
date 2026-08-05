export type ProjectFilterOption = {
  provider: string;
  projectPath: string;
  count: number;
};

export const filterProjectOptions = <T extends ProjectFilterOption>(
  projects: readonly T[],
  query: string,
): T[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery === "") return [...projects];

  return projects.filter((project) =>
    project.projectPath.toLocaleLowerCase().includes(normalizedQuery),
  );
};
