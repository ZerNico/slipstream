/**
 * Every glyph the app draws, by what it means. One glyph per meaning: a new meaning is added
 * here on purpose, and nothing else imports the icon set (`import { RecordIcon } from
 * "~/ui/icons.ts"`, drawn with `<Icon icon={RecordIcon} />`).
 */
export {
  // Places (navigation: the same five words on every breakpoint)
  Home01Icon as HomeIcon,
  Calendar03Icon as GuideIcon,
  VideoReplayIcon as RecordingsIcon,
  MagicWand01Icon as RulesIcon,
  Settings01Icon as SettingsIcon,
  // Playback
  PlayIcon,
  PauseIcon,
  GoBackward10SecIcon as Back10Icon,
  GoForward10SecIcon as Forward10Icon,
  PreviousIcon as FromStartIcon,
  NextIcon as GoLiveIcon,
  LiveStreaming02Icon as LiveIcon,
  VolumeHighIcon as VolumeIcon,
  VolumeLowIcon,
  VolumeOffIcon as MuteIcon,
  SubtitleIcon as AudioSubtitlesIcon,
  DashboardSpeed01Icon as QualityIcon,
  FullScreenIcon as FullscreenIcon,
  MinimizeScreenIcon as ExitFullscreenIcon,
  AspectRatioIcon as FitIcon,
  ZoomInAreaIcon as FillIcon,
  SidebarRightIcon as PanelIcon,
  PictureInPictureOnIcon as PipIcon,
  // Recording
  RecordIcon,
  Shield01Icon as ProtectIcon,
  Clock01Icon as ClockIcon,
  // Actions
  Search01Icon as SearchIcon,
  Add01Icon as AddIcon,
  MinusSignIcon as MinusIcon,
  Tick02Icon as CheckIcon,
  Cancel01Icon as CloseIcon,
  Delete02Icon as DeleteIcon,
  PencilEdit02Icon as EditIcon,
  RefreshIcon,
  UndoIcon,
  MoreHorizontalIcon as MoreIcon,
  DragDropVerticalIcon as GripIcon,
  FilterHorizontalIcon as FilterIcon,
  Link01Icon as LinkIcon,
  Tag01Icon as LabelIcon,
  ArrowDataTransferHorizontalIcon as SwitchIcon,
  Logout03Icon as SignOutIcon,
  // Lineup
  StarIcon as FavouriteIcon,
  ViewIcon as ShowIcon,
  HashtagIcon as NumberIcon,
  ArrowUpDoubleIcon as ToTopIcon,
  SplitIcon,
  Unlink01Icon as UnlinkIcon,
  // Direction
  ArrowRight01Icon as ChevronRightIcon,
  ArrowLeft01Icon as ChevronLeftIcon,
  ArrowDown01Icon as ChevronDownIcon,
  ArrowLeft02Icon as BackIcon,
  ArrowRight02Icon as ForwardIcon,
  // Views
  GridViewIcon as GridIcon,
  Menu01Icon as ListIcon,
  // Theme
  Sun03Icon as LightIcon,
  Moon02Icon as DarkIcon,
  ComputerIcon as SystemThemeIcon,
  // People and devices
  UserIcon,
  UserGroupIcon as UsersIcon,
  LockIcon,
  TvSmartIcon as TvIcon,
  SmartPhone01Icon as PhoneIcon,
  Tablet01Icon as TabletIcon,
  LaptopIcon,
  KeyboardIcon,
  LanguageCircleIcon as LanguageIcon,
  LayoutTemplateIcon as TemplateIcon,
  // System
  ServerStack01Icon as ServerIcon,
  CpuIcon,
  HardDriveIcon as StorageIcon,
  Folder01Icon as FolderIcon,
  WifiOff01Icon as OfflineIcon,
  // Artwork sources
  Image01Icon as ImageIcon,
  ViewOffSlashIcon as HideIcon,
  SparklesIcon as GeneratedIcon,
  // Feedback
  InformationCircleIcon as InfoIcon,
  Alert02Icon as WarningIcon,
  CheckmarkCircle02Icon as SuccessIcon,
} from "@hugeicons/core-free-icons";
