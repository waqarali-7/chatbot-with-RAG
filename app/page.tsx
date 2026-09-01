import Chat from './Chat';
import { chatDisclosure } from './disclosure';

export const dynamic = 'force-dynamic';

export default function Page() {
  const disclosure = chatDisclosure();
  return (
    <Chat
      business="Meridian Dental & Aesthetics"
      showInfoCardLink={disclosure.showInfoCardLink}
      showInterfaceLabel={disclosure.showInterfaceLabel}
      openingLine={disclosure.openingLine}
    />
  );
}
