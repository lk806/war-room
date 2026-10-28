import { queryOptions } from "@tanstack/react-query";
import type {
  AiStatus,
  BoardData,
  ContributionRange,
  ContributionSummary,
  FileItem,
  Group,
  Meeting,
  ReminderItem,
  User,
} from "@war-room/shared";
import { api } from "./api.ts";

export const meQuery = () =>
  queryOptions({
    queryKey: ["me"],
    queryFn: async (): Promise<User> => {
      const data = await api<{ user: User }>("/api/auth/me");
      return data.user;
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

export const groupsQuery = () =>
  queryOptions({
    queryKey: ["groups"],
    queryFn: async (): Promise<Group[]> => {
      const data = await api<{ groups: Group[] }>("/api/groups");
      return data.groups;
    },
  });

export const boardQuery = (groupId: string) =>
  queryOptions({
    queryKey: ["board", groupId],
    queryFn: () => api<BoardData>(`/api/groups/${groupId}/board`),
    enabled: Boolean(groupId),
  });

export const remindersQuery = (groupId: string) =>
  queryOptions({
    queryKey: ["reminders", groupId],
    queryFn: async () =>
      (await api<{ reminders: ReminderItem[] }>(`/api/groups/${groupId}/reminders`)).reminders,
    enabled: Boolean(groupId),
  });

export const filesQuery = (groupId: string) =>
  queryOptions({
    queryKey: ["files", groupId],
    // 顺带把服务端生效的单文件上限带回来，避免前端写死数字
    queryFn: () => api<{ files: FileItem[]; maxBytes: number }>(`/api/groups/${groupId}/files`),
    enabled: Boolean(groupId),
  });

export const aiStatusQuery = () =>
  queryOptions({
    queryKey: ["ai-status"],
    queryFn: () => api<AiStatus>("/api/ai/status"),
    staleTime: 5 * 60_000,
  });

export const contributionsQuery = (groupId: string, range: ContributionRange) =>
  queryOptions({
    queryKey: ["contributions", groupId, range],
    queryFn: () =>
      api<ContributionSummary>(`/api/groups/${groupId}/contributions?range=${range}`),
    enabled: Boolean(groupId),
  });

export const meetingsQuery = (groupId: string) =>
  queryOptions({
    queryKey: ["meetings", groupId],
    queryFn: async () =>
      (await api<{ meetings: Meeting[] }>(`/api/groups/${groupId}/meetings`)).meetings,
    enabled: Boolean(groupId),
  });

export const meetingQuery = (meetingId: string) =>
  queryOptions({
    queryKey: ["meeting", meetingId],
    queryFn: async () =>
      (await api<{ meeting: Meeting }>(`/api/meetings/${meetingId}`)).meeting,
    enabled: Boolean(meetingId),
    // 转写中自动轮询，SSE 断了也能看到进度
    refetchInterval: (query) =>
      query.state.data?.status === "TRANSCRIBING" ? 1200 : false,
  });
