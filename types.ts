
export interface Transcription {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  isFinal: boolean;
}
