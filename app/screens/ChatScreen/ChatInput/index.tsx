import ThemedButton from '@components/buttons/ThemedButton'
import PopupMenu from '@components/views/PopupMenu'
import { MaterialIcons } from '@expo/vector-icons'
import { XAxisOnlyTransition } from '@lib/animations/transitions'
import { AppSettings } from '@lib/constants/GlobalValues'
import { generateResponse } from '@lib/engine/Inference'
import { useUnfocusTextInput } from '@lib/hooks/UnfocusTextInput'
import { Characters } from '@lib/state/Characters'
import { Chats, useInference } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { getDocumentAsync } from 'expo-document-picker'
import { Image } from 'expo-image'
import React, { useState } from 'react'
import { TextInput, TouchableOpacity, View, Text } from 'react-native'
import { useMMKVBoolean } from 'react-native-mmkv'
import Animated, {
    BounceIn,
    FadeIn,
    FadeOut,
    LinearTransition,
    ZoomOut,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import ChatOptions from './ChatInputOptions'

// 🚀 GEMU: Importing the raw Llama engine to bypass the chat bubbles!
import { Llama } from '@lib/engine/Local/LlamaLocal'

export type Attachment = {
    uri: string
    type: 'image' | 'audio' | 'document'
    name: string
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

type ChatInputHeightStoreProps = {
    height: number
    setHeight: (n: number) => void
}

export const useInputHeightStore = create<ChatInputHeightStoreProps>()((set) => ({
    height: 54,
    setHeight: (n) => set({ height: Math.ceil(n) }),
}))

const ChatInput = () => {
    const insets = useSafeAreaInsets()
    const inputRef = useUnfocusTextInput()

    const { color, borderRadius, spacing } = Theme.useTheme()
    const [sendOnEnter, _] = useMMKVBoolean(AppSettings.SendOnEnter)
    const [attachments, setAttachments] = useState<Attachment[]>([])
    const [hideOptions, setHideOptions] = useState(false)
    const { addEntry } = Chats.useEntry()
    const { nowGenerating, abortFunction } = useInference(
        useShallow((state) => ({
            nowGenerating: state.nowGenerating,
            abortFunction: state.abortFunction,
        }))
    )
    const setHeight = useInputHeightStore(useShallow((state) => state.setHeight))

    const { charName } = Characters.useCharacterStore(
        useShallow((state) => ({
            charName: state?.card?.name,
        }))
    )

    const { userName } = Characters.useUserStore(
        useShallow((state) => ({ userName: state.card?.name }))
    )

    const [newMessage, setNewMessage] = useState<string>('')

    // ==========================================
    // 🚀 GEMU EDITION: CHATGPT STYLE STATE
    // ==========================================
    const [showModifiers, setShowModifiers] = useState(false);
    const [activeMode, setActiveMode] = useState<string | null>(null);
    
    // ⚡ LIVE ENHANCER STATES
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [enhanceProgress, setEnhanceProgress] = useState(0);

    const getModeConfig = (mode: string | null) => {
        switch(mode) {
            case 'fix': return { icon: '🪄', name: 'Fix Grammar', color: '#00e676', bg: '#00e67620' };
            case 'logic': return { icon: '🧠', name: 'Strict Logic', color: '#00b0ff', bg: '#00b0ff20' };
            case 'fun': return { icon: '🎨', name: 'Creative Mode', color: '#ff4081', bg: '#ff408120' };
            case 'max': return { icon: '✨', name: 'Max (Invisible Wrapper)', color: '#ffeb3b', bg: '#ffeb3b20' };
            case 'enhance_normal': return { icon: '🌟', name: 'Normal Enhancing (Live AI)', color: '#8c9eff', bg: '#8c9eff20' };
            case 'enhance_create': return { icon: '⚡', name: 'C.R.E.A.T.E Enhancing (Live AI)', color: '#b388ff', bg: '#b388ff20' };
            default: return null;
        }
    }

    // ==========================================
    // ⚡ PHASE 2: THE REAL LOCAL AI BACKGROUND ENHANCER
    // ==========================================
    const runRealEnhancer = async (type: 'normal' | 'create') => {
        if (!newMessage || newMessage.trim() === '') {
            Logger.warnToast("Type a prompt first before enhancing!");
            return;
        }
        
        // Grab the raw context directly from your loaded local model
        const llamaContext = Llama.useLlamaModelStore.getState().context;
        if (!llamaContext) {
            Logger.warnToast("No local model loaded! Please load a model to use AI Enhance.");
            return;
        }

        setIsEnhancing(true);
        setEnhanceProgress(5); 

        // Switch between the Normal or the C.R.E.A.T.E Meta-Prompt
        const metaPrompt = type === 'create' 
            ? `System: You are an elite Prompt Engineer. Your task is to rewrite the user's short prompt into a highly detailed, professional AI instruction using the C.R.E.A.T.E framework (Character, Request, Example, Adjustments, Type of output, Extra Guidance). Output ONLY the newly enhanced prompt. Do not add any conversational filler.\n\nUser's Raw Prompt: ${newMessage}\n\nEnhanced Prompt:`
            : `System: You are an expert AI assistant. Your task is to take the user's short prompt and rewrite it to be clearer, more detailed, and highly effective. Output ONLY the enhanced prompt without any conversational filler or introductions.\n\nUser's Raw Prompt: ${newMessage}\n\nEnhanced Prompt:`;

        let generatedText = "";

        try {
            // We bypass Inference.ts and run a raw completion directly in the background!
            const result = await llamaContext.completion(
                {
                    prompt: metaPrompt,
                    n_predict: 500, // Max tokens for the rewritten prompt
                    temperature: 0.4, // Low temp for highly accurate rewriting
                    stop: ["<|im_end|>", "</s>", "[/INST]", "<|eot_id|>"], // Universal stops
                },
                (data: any) => {
                    // ⚡ REAL TIME: This fires for every single word the AI generates!
                    generatedText += data.token;
                    // Increment the loading bar smoothly as words actually come in
                    setEnhanceProgress((prev) => (prev < 95 ? prev + 1 : prev));
                }
            );

            // Once generation is done, fill the bar and swap the text!
            setEnhanceProgress(100);
            
            // Fix the bug: Extract text and immediately unlock the box
            const finalText = result.text ? result.text.trim() : generatedText.trim();
            setNewMessage(finalText);
            setIsEnhancing(false); // Instantly unlocks!
            Logger.infoToast(type === 'create' ? "⚡ C.R.E.A.T.E Enhancement Complete!" : "🌟 Normal Enhancement Complete!");

        } catch (error) {
            setIsEnhancing(false); // Guarantee unlock even if it crashes
            Logger.errorToast("Enhancement Failed: " + error);
        }
    };
    // ==========================================

    const abortResponse = async () => {
        Logger.info(`Aborting Generation`)
        if (abortFunction) await abortFunction()
    }

    const handleSend = async () => {
        if (newMessage.trim() === '' && attachments.length === 0) return;

        // 🚀 GEMU: Invisible Injection
        let finalMessage = newMessage;
        
        if (activeMode === 'fix') {
            finalMessage = "[System: Fix all grammar, spelling, and format this text beautifully.]\n\n" + finalMessage;
        } else if (activeMode === 'logic') {
            finalMessage = "[System: Answer with strict logic, step-by-step reasoning, and high accuracy. No fluff.]\n\n" + finalMessage;
        } else if (activeMode === 'fun') {
            finalMessage = "[System: Be highly creative, engaging, use emojis, and act like a fun persona!]\n\n" + finalMessage;
        } else if (activeMode === 'max') {
            finalMessage = `[SYSTEM AUTO-ENHANCER ACTIVE]
You are an Elite AI Prompt Engineer. The user has provided a raw, quick prompt below. Ignore any spelling or grammar mistakes.
Instead of answering normally, internally upgrade this prompt using the C.R.E.A.T.E. formula before executing it:
- Character: Assume the role of a world-class expert on this topic.
- Request: Identify and flawlessly execute the core task.
- Example: Apply high-quality references and industry standards.
- Adjustments: Optimize the structure for maximum impact and engagement.
- Type of output: Format beautifully (use Markdown, tables, or bullets if it makes sense).
- Extra Guidance: Ensure zero hallucinations and make it easy to understand.

Now, execute the user's raw request using this elite C.R.E.A.T.E. framework:
` + finalMessage;
        }

        await addEntry(
            userName ?? '',
            true,
            finalMessage, 
            attachments.map((item) => item.uri)
        )
        
        const swipeId = await addEntry(charName ?? '', false, '')
        
        setNewMessage('')
        setAttachments([])
        setActiveMode(null);
        setShowModifiers(false);
        
        if (swipeId) generateResponse(swipeId)
    }

    const activeConfig = getModeConfig(activeMode);

    return (
        <View
            onLayout={(e) => {
                setHeight(e.nativeEvent.layout.height)
            }}
            style={{
                position: 'absolute',
                width: '98%',
                alignSelf: 'center',
                bottom: insets.bottom,
                marginVertical: spacing.m,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.sm,
                backgroundColor: color.neutral._100 + 'cc',
                borderWidth: 1,
                borderColor: color.neutral._200,
                boxShadow: [
                    {
                        offsetX: 1,
                        offsetY: 1,
                        color: color.shadow,
                        spreadDistance: 1,
                        blurRadius: 4,
                    },
                ],
                borderRadius: 24, 
                rowGap: spacing.m,
            }}>
            
            {/* ========================================== */}
            {/* 🚀 GEMU EDITION: VERTICAL CHATGPT MENU     */}
            {/* ========================================== */}
            {showModifiers && !isEnhancing && (
                <Animated.View entering={FadeIn} exiting={FadeOut} style={{ flexDirection: 'column', alignItems: 'flex-start', paddingHorizontal: 12, paddingBottom: 8, rowGap: 8 }}>
                    {['fix', 'logic', 'fun', 'max', 'enhance_normal', 'enhance_create'].map((mode) => {
                        const config = getModeConfig(mode);
                        return (
                            <TouchableOpacity 
                                key={mode}
                                onPress={() => {
                                    if (mode === 'enhance_normal') {
                                        runRealEnhancer('normal');
                                        setShowModifiers(false);
                                    } else if (mode === 'enhance_create') {
                                        runRealEnhancer('create');
                                        setShowModifiers(false);
                                    } else {
                                        setActiveMode(activeMode === mode ? null : mode);
                                        setShowModifiers(false); 
                                    }
                                }}
                                style={{ paddingVertical: 10, paddingHorizontal: 16, backgroundColor: color.neutral._200, borderRadius: 20, borderWidth: 1, borderColor: activeMode === mode ? config?.color : 'transparent', flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={{ color: color.text._100, fontWeight: '600', fontSize: 14 }}>
                                    <Text style={{ color: config?.color }}>{config?.icon}</Text>  {config?.name}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </Animated.View>
            )}

            {/* ========================================== */}
            {/* 🚀 GEMU EDITION: THE LIVE LOADING BAR      */}
            {/* ========================================== */}
            {isEnhancing && (
                <Animated.View entering={FadeIn} exiting={FadeOut} style={{ paddingHorizontal: spacing.m, paddingBottom: 8, paddingTop: 6 }}>
                    <Text style={{ color: '#b388ff', fontSize: 13, marginBottom: 8, fontWeight: 'bold' }}>
                        ⚡ Enhancing Prompt with AI... {enhanceProgress}%
                    </Text>
                    <View style={{ height: 6, backgroundColor: color.neutral._300, borderRadius: 3, overflow: 'hidden' }}>
                        <View style={{ height: '100%', width: `${enhanceProgress}%`, backgroundColor: '#b388ff' }} />
                    </View>
                </Animated.View>
            )}

            {/* ========================================== */}
            {/* 🚀 GEMU EDITION: CHATGPT ACTIVE PILL       */}
            {/* ========================================== */}
            {activeMode && !showModifiers && !isEnhancing && (
                <Animated.View entering={FadeIn} exiting={FadeOut} style={{ paddingHorizontal: spacing.m, paddingBottom: 2, paddingTop: 6 }}>
                    <TouchableOpacity 
                        onPress={() => setActiveMode(null)}
                        style={{
                            alignSelf: 'flex-start',
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: activeConfig?.bg,
                            paddingVertical: 6,
                            paddingHorizontal: 12,
                            borderRadius: 16,
                            borderWidth: 1,
                            borderColor: activeConfig?.color,
                        }}>
                        <Text style={{ color: activeConfig?.color, fontWeight: 'bold', fontSize: 12 }}>
                            {activeConfig?.icon} {activeConfig?.name}  ✕
                        </Text>
                    </TouchableOpacity>
                </Animated.View>
            )}
            {/* ========================================== */}

            <Animated.FlatList
                itemLayoutAnimation={LinearTransition}
                style={{
                    display: attachments.length > 0 ? 'flex' : 'none',
                    padding: spacing.l,
                    backgroundColor: color.neutral._200,
                    borderRadius: borderRadius.m,
                }}
                horizontal
                contentContainerStyle={{ columnGap: spacing.xl }}
                data={attachments}
                keyExtractor={(item) => item.uri}
                renderItem={({ item }) => {
                    return (
                        <Animated.View
                            entering={BounceIn}
                            exiting={ZoomOut.duration(100)}
                            style={{ alignItems: 'center', maxWidth: 80, rowGap: 8 }}>
                            <Image
                                source={{ uri: item.uri }}
                                style={{
                                    width: 64,
                                    height: undefined,
                                    aspectRatio: 1,
                                    borderRadius: borderRadius.m,
                                    borderWidth: 1,
                                    borderColor: color.primary._500,
                                }}
                            />

                            <ThemedButton
                                iconName="close"
                                iconSize={20}
                                buttonStyle={{
                                    borderWidth: 0,
                                    paddingHorizontal: 2,
                                    position: 'absolute',
                                    alignSelf: 'flex-end',
                                    margin: -4,
                                }}
                                onPress={() => {
                                    setAttachments(attachments.filter((a) => a.uri !== item.uri))
                                }}
                            />
                        </Animated.View>
                    )
                }}
            />
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'flex-end', 
                    columnGap: spacing.m,
                }}>
                <Animated.View layout={XAxisOnlyTransition}>
                    {!hideOptions && (
                        <Animated.View
                            entering={FadeIn}
                            exiting={FadeOut}
                            style={{ flexDirection: 'row', columnGap: 8, alignItems: 'center', paddingBottom: 8 }}>
                            <ChatOptions />
                            <PopupMenu
                                icon="paperclip"
                                iconSize={20}
                                options={[
                                    {
                                        label: 'Add Image',
                                        icon: 'picture',
                                        onPress: async (menuRef) => {
                                            menuRef.current?.close()
                                            const result = await getDocumentAsync({
                                                type: 'image/*',
                                                multiple: true,
                                                copyToCacheDirectory: true,
                                            })
                                            if (result.canceled || result.assets.length < 1) return

                                            const newAttachments = result.assets
                                                .map((item) => ({
                                                    uri: item.uri,
                                                    type: 'image',
                                                    name: item.name,
                                                }))
                                                .filter(
                                                    (item) =>
                                                        !attachments.some(
                                                            (a) => a.name === item.name
                                                        )
                                                ) as Attachment[]
                                            setAttachments([...attachments, ...newAttachments])
                                        },
                                    },
                                ]}
                                style={{
                                    color: color.text._400,
                                    padding: 6,
                                    backgroundColor: color.neutral._200,
                                    borderRadius: 16,
                                }}
                                placement="top"
                            />
                            
                            {/* 🚀 GEMU EDITION: THE SPARKLE TRIGGER BUTTON */}
                            <TouchableOpacity 
                                onPress={() => setShowModifiers(!showModifiers)} 
                                disabled={isEnhancing}
                                style={{ 
                                    padding: 6, 
                                    backgroundColor: showModifiers ? color.primary._600 : color.neutral._200, 
                                    borderRadius: 16 
                                }}>
                                <MaterialIcons 
                                    name="auto-awesome" 
                                    size={20} 
                                    color={showModifiers ? color.text._100 : color.text._400} 
                                />
                            </TouchableOpacity>

                        </Animated.View>
                    )}
                    {hideOptions && (
                        <Animated.View entering={FadeIn} exiting={FadeOut} style={{ paddingBottom: 8 }}>
                            <ThemedButton
                                iconSize={18}
                                iconStyle={{
                                    color: color.text._400,
                                }}
                                buttonStyle={{
                                    padding: 5,
                                    backgroundColor: color.neutral._200,
                                    borderRadius: 32,
                                }}
                                variant="tertiary"
                                iconName="right"
                                onPress={() => setHideOptions(false)}
                            />
                        </Animated.View>
                    )}
                </Animated.View>
                <AnimatedTextInput
                    layout={XAxisOnlyTransition}
                    ref={inputRef}
                    editable={!isEnhancing} 
                    style={{
                        color: color.text._100,
                        backgroundColor: color.neutral._100,
                        flex: 1,
                        borderWidth: 0, 
                        borderRadius: borderRadius.l,
                        paddingHorizontal: spacing.m,
                        paddingTop: 12,
                        paddingBottom: 12,
                        maxHeight: 120, 
                        opacity: isEnhancing ? 0.5 : 1, 
                    }}
                    onPress={() => {
                        setHideOptions(!!newMessage)
                    }}
                    placeholder="Message Gemu..."
                    placeholderTextColor={color.text._600}
                    value={newMessage}
                    onChangeText={(text) => {
                        setHideOptions(!!text)
                        setNewMessage(text)
                    }}
                    multiline
                    submitBehavior={sendOnEnter ? 'blurAndSubmit' : 'newline'}
                    onSubmitEditing={sendOnEnter ? handleSend : undefined}
                />
                <Animated.View layout={XAxisOnlyTransition} style={{ paddingBottom: 6 }}>
                    <TouchableOpacity
                        style={{
                            borderRadius: 24,
                            backgroundColor: nowGenerating ? color.error._500 : (newMessage.trim() || attachments.length > 0) ? color.primary._500 : color.neutral._300,
                            padding: spacing.m,
                        }}
                        disabled={(!nowGenerating && newMessage.trim() === '' && attachments.length === 0) || isEnhancing}
                        onPress={nowGenerating ? abortResponse : handleSend}>
                        <MaterialIcons
                            name={nowGenerating ? 'stop' : 'arrow-upward'} 
                            color={color.neutral._100}
                            size={20}
                        />
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </View>
    )
}

export default ChatInput
